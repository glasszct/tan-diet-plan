"use strict";
/*
 * Minimal QQ SMTP sender (implicit TLS, port 465).
 * Usage: node smtp-send.js <host> <port> <user> <to> <subject> <html-file>
 * The password is read from env QQ_SMTP_CODE so it never appears in argv.
 */

const fs = require("fs");
const tls = require("tls");

const [hostArg, portArg, userArg, toArg, subjectArg, htmlArg] = process.argv.slice(2);
const host = hostArg || process.env.SMTP_HOST;
const portRaw = portArg || process.env.SMTP_PORT;
const user = userArg || process.env.SMTP_USER;
const to = toArg || process.env.SMTP_TO;
const subject = subjectArg || process.env.SMTP_SUBJECT;
const htmlFile = htmlArg || process.env.SMTP_HTML_FILE || "mail-body.html";
const password = process.env.QQ_SMTP_CODE;
const port = Number(portRaw || 465);

if (!host || !port || !user || !to || !subject || !htmlFile || !password) {
  console.error("usage: node smtp-send.js <host> <port> <user> <to> <subject> <html-file>");
  process.exit(2);
}

const html = fs.readFileSync(htmlFile, "utf8");
const body = [
  "From: =?UTF-8?B?" + Buffer.from("谭式餐桌", "utf8").toString("base64") + "?= <" + user + ">",
  "To: <" + to + ">",
  "Subject: =?UTF-8?B?" + Buffer.from(subject, "utf8").toString("base64") + "?=",
  "MIME-Version: 1.0",
  'Content-Type: text/html; charset="UTF-8"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from(html, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trim()
].join("\r\n");

const socket = tls.connect({ host, port, servername: host });
socket.setTimeout(30000, () => fail(new Error("SMTP timeout")));
socket.on("error", fail);

async function* lines() {
  let buffer = "";
  for await (const chunk of socket) {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      yield buffer.slice(0, at + 1);
      buffer = buffer.slice(at + 1);
    }
  }
}

const reader = lines();

async function reply() {
  let line = (await reader.next()).value;
  if (line == null) throw new Error("SMTP connection closed");
  const code = Number(line.slice(0, 3));
  let text = line;
  while (line[3] === "-") {
    line = (await reader.next()).value;
    if (line == null) throw new Error("SMTP connection closed");
    text += line;
  }
  return { code, text: text.trim() };
}

async function send(command) {
  socket.write(command + "\r\n");
  return reply();
}

function expect(current, expected, label) {
  if (current.code !== expected) {
    throw new Error(label + " failed: " + current.code + " " + current.text);
  }
}

let failed = false;
function fail(error) {
  if (failed) return;
  failed = true;
  console.error("FAIL " + error.message);
  socket.destroy();
  process.exit(1);
}

async function run() {
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
  expect(await reply(), 220, "greeting");
  expect(await send("EHLO localhost"), 250, "EHLO");
  expect(await send("AUTH LOGIN"), 334, "AUTH LOGIN");
  expect(await send(Buffer.from(user, "utf8").toString("base64")), 334, "username");
  expect(await send(Buffer.from(password, "utf8").toString("base64")), 235, "password");
  expect(await send("MAIL FROM:<" + user + ">"), 250, "MAIL FROM");
  expect(await send("RCPT TO:<" + to + ">"), 250, "RCPT TO");
  expect(await send("DATA"), 354, "DATA");
  expect(await send(body + "\r\n."), 250, "message body");
  await send("QUIT");
  socket.end();
  console.log("OK");
}

run().catch(fail);
