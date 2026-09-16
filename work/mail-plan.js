"use strict";
/*
 * 每日计划邮件内容生成器。
 * 数据直接从网站 HTML 里读，网站改了邮件跟着变，不维护第二份餐单。
 * 用法：node mail-plan.js [--date=2026-09-15] [--out=预览.html]
 * 输出：stdout 一段 JSON {subject, html}
 */

const fs = require("fs");
const path = require("path");

const PAGE = path.join(__dirname, "..", "outputs", "谭式餐桌.html");
const html = fs.readFileSync(PAGE, "utf8");

const start = html.indexOf("var MENUS");
const end = html.indexOf("var PRINCIPLES");
if (start < 0 || end < 0) throw new Error("网站改版了：读不到 MENUS..PRINCIPLES 数据段");
const site = new Function(html.slice(start, end) + "\nreturn {MENUS,GOALS,TRAIN,EX,EPOCH};")();

const WEEKS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const strip = (s) =>
  String(s)
    .replace(/<span class="q">/g, " - ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

/* 护肤流程从网站卡片里抠出来，同样避免两份内容 */
function skinCard(id) {
  const at = html.indexOf('id="' + id + '"');
  if (at < 0) throw new Error("网站改版了：找不到护肤卡片 " + id);
  const chunk = html.slice(at, html.indexOf("</article>", at));
  const items = [...chunk.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => strip(m[1]));
  const note = (chunk.match(/class="skin-note">([\s\S]*?)<\/p>/) || [])[1];
  return { items, note: note ? strip(note) : "" };
}

const SKIN = { am: skinCard("skinAmCard"), pm: skinCard("skinPmCard") };

function parseDateArg() {
  const arg = process.argv.find((a) => a.startsWith("--date="));
  if (arg) {
    const [y, m, d] = arg.slice(7).split("-").map(Number);
    return [y, m, d];
  }
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return [get("year"), get("month"), get("day")];
}

/* 完全照搬网站 planOf / dayIdx 的算法，保证邮件和网页同一天同一套计划 */
function planFor(y, m, d) {
  const e = site.EPOCH;
  const epoch = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  const day = new Date(y, m - 1, d);
  const diff = Math.round((day - epoch) / 864e5);
  const rest = (((diff % 2) + 2) % 2) === 1;
  const tIdx = ((Math.floor(diff / 2) % site.TRAIN.length) + site.TRAIN.length) % site.TRAIN.length;
  const dayOfYear = Math.floor((day - new Date(y, 0, 0)) / 864e5);
  const menu = site.MENUS[((dayOfYear % site.MENUS.length) + site.MENUS.length) % site.MENUS.length];
  const goal = site.GOALS[rest ? "rest" : "train"];
  const train = rest ? null : site.TRAIN[tIdx];
  return { y, m, d, diff, rest, menu, goal, train };
}

function tasksFor(p) {
  const common = [
    "饮水 8 杯 ≈ 2900 ml，小口多次，别等渴了再喝",
    "晨起空腹排便后称一次体重，看周趋势",
    "23:00 前睡觉，睡前拉伸 10 分钟放松"
  ];
  if (p.rest) {
    return [
      "有氧 30-40 分钟，出门快走凑够 8000 步",
      "晚餐主食减半拳，睡前保持一点点饥饿感",
      "今天不动大重量，只做恢复"
    ].concat(common);
  }
  return [
    "训练 " + p.train.mins + " 分钟：" + p.train.title,
    "练后 30 分钟内把加餐的酸奶吃掉，别拖过窗口期",
    "训练前按热身清单激活，再上正式重量"
  ].concat(common);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildHtml(p) {
  const goal = p.goal;
  const title =
    p.m + "月" + p.d + "日 " + WEEKS[new Date(p.y, p.m - 1, p.d).getDay()] +
    " · " + (p.rest ? "休息日" : p.train.title.split(" · ")[0]) +
    " · " + p.menu.tag;

  const head = (t, note) =>
    '<div style="font-size:15px;font-weight:700;margin:0 0 10px;color:#173F32">' + t +
    (note ? '<span style="font-weight:400;font-size:12.5px;color:#5C7368"> · ' + note + "</span>" : "") +
    "</div>";

  const sec = (inner) => '<div style="padding:18px 22px;border-top:1px solid #EDF3EF">' + inner + "</div>";

  const tasks = tasksFor(p)
    .map(
      (t) =>
        '<div style="margin:0 0 7px;padding-left:16px;position:relative">' +
        '<span style="position:absolute;left:0;color:#2E7D5B;font-weight:700">□</span>' + esc(t) + "</div>"
    )
    .join("");

  const meals = p.menu.meals
    .map(
      (m) =>
        '<div style="border:1px solid #EDF3EF;border-radius:10px;padding:11px 14px;margin-bottom:9px">' +
        '<div style="font-weight:700">' + esc(m.name) +
        '<span style="font-weight:400;color:#5C7368;font-size:12.5px"> · 建议 ' + m.time +
        " · ≈ " + m.kcal + " kcal · 蛋白 " + m.pro + " g</span></div>" +
        '<div style="margin-top:5px;color:#33544A">' + esc(m.items.join(" · ")) + "</div>" +
        "</div>"
    )
    .join("");

  const mealTotal = p.menu.meals.reduce((a, m) => a + m.kcal, 0);

  const workout = p.rest
    ? sec(
        head("今日恢复安排", "练一天休一天") +
          '<div style="color:#33544A">休息日不是躺平：快走 30-40 分钟把有氧补上，' +
          "睡前拉伸 10 分钟，让肌肉和激素把训练那天的刺激长成肌肉。晚餐主食减半拳，睡前留一点饿感。</div>"
      )
    : sec(
        head("今日训练", p.train.title + " · " + p.train.mins + " 分钟") +
          '<div style="margin-bottom:10px;color:#5C7368;font-size:12.5px">热身：' + esc(p.train.warm) + "</div>" +
          p.train.exs
            .map(
              (id, i) =>
                '<div style="margin:0 0 9px;padding-left:22px;position:relative">' +
                '<span style="position:absolute;left:0;color:#2E7D5B;font-weight:700">' + (i + 1) + "</span>" +
                "<b>" + esc(site.EX[id].name) + "</b>" +
                '<span style="color:#5C7368;font-size:12.5px"> · ' + esc(site.EX[id].sets) + "</span>" +
                '<div style="color:#5C7368;font-size:12.5px;margin-top:2px">' +
                esc(site.EX[id].cues.join(" ／ ")) +
                "</div></div>"
            )
            .join("")
      );

  const skinSteps = (list, start) =>
    list
      .map(
        (t, i) =>
          '<div style="margin:0 0 6px;padding-left:20px;position:relative">' +
          '<span style="position:absolute;left:0;color:#2E7D5B;font-weight:700">' + (start + i) + "</span>" +
          esc(t) + "</div>"
      )
      .join("");

  return (
    '<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #DCE7E0;' +
    "border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;" +
    'color:#173F32;line-height:1.7;font-size:14px">' +
    '<div style="background:#2E7D5B;padding:20px 22px">' +
    '<div style="color:#CFE7DC;font-size:12px">谭式餐桌 · 每日计划</div>' +
    '<div style="color:#FFFFFF;font-size:21px;font-weight:700;margin-top:6px">' + esc(title) + "</div>" +
    '<div style="color:#E4F0EA;font-size:12.5px;margin-top:8px">' +
    esc(goal.label) + "　|　目标 <b>" + goal.kcal + "</b> kcal　|　蛋白 " + goal.p +
    " g　|　碳水 " + goal.c + " g　|　脂肪 " + goal.f + " g</div></div>" +
    sec(head("今日必做") + tasks) +
    workout +
    sec(
      head("今日餐单", p.menu.tag + " · 合计 ≈ " + mealTotal + " kcal") +
        meals +
        '<div style="color:#5C7368;font-size:12.5px">吃饭顺序：先喝汤吃菜 → 再吃肉 → 最后主食，七分饱停筷。' +
        "每餐按 211 装盘：2 拳蔬菜 + 1 掌心蛋白 + 1 拳主食。</div>"
    ) +
    sec(
      head("护肤 · 早间 3 分钟") +
        skinSteps(SKIN.am.items, 1) +
        '<div style="color:#5C7368;font-size:12.5px;margin-top:6px">' + esc(SKIN.am.note) + "</div>"
    ) +
    sec(
      head("护肤 · 晚间 5 分钟") +
        skinSteps(SKIN.pm.items, 1) +
        '<div style="color:#5C7368;font-size:12.5px;margin-top:6px">' + esc(SKIN.pm.note) + "</div>"
    ) +
    sec(
      '<div style="color:#5C7368;font-size:12.5px">' + esc(goal.tip) +
        "<br>本邮件每天 06:00 自动发送，计划内容与网站同步。看详细动作演示与打点记录：" +
        '<a href="{SITE_URL}" style="color:#2E7D5B">{SITE_URL}</a></div>'
    ) +
    "</div>"
  );
}

const [y, m, d] = parseDateArg();
const p = planFor(y, m, d);
const subject =
  m + "月" + d + "日 " + WEEKS[new Date(y, m - 1, d).getDay()] + "｜" +
  (p.rest ? "休息日 · 有氧恢复" : p.train.title.split(" · ")[0] + "训练") +
  " + " + p.menu.tag + "｜谭式餐桌";
const out = { subject, html: buildHtml(p) };

const siteArg = process.argv.find((a) => a.startsWith("--site-url="));
if (siteArg) out.html = out.html.split("{SITE_URL}").join(siteArg.slice(11));

const outArg = process.argv.find((a) => a.startsWith("--out="));
if (outArg) fs.writeFileSync(outArg.slice(6), out.html, "utf8");

const subjectArg = process.argv.find((a) => a.startsWith("--subject-out="));
if (subjectArg) fs.writeFileSync(subjectArg.slice(14), subject, "utf8");

if (process.argv.includes("--check")) {
  const assert = require("assert");
  assert.strictEqual(p.menu.meals.length, 4, "每天应有 4 餐");
  const first = planFor(2026, 8, 31);
  assert.strictEqual(first.rest, false, "2026-08-31 应为推日");
  assert.strictEqual(first.train.title.indexOf("推日"), 0, "2026-08-31 应是推日");
  assert.strictEqual(planFor(2026, 9, 1).rest, true, "2026-09-01 应为休息日");
  assert.strictEqual(planFor(2026, 9, 15).rest, true, "2026-09-15 应为休息日（练一休一）");
  assert.ok(SKIN.am.items.length >= 4 && SKIN.pm.items.length >= 4, "护肤早晚流程不少于 4 步");
  assert.ok(out.html.indexOf("今日餐单") > 0 && out.html.length > 3000, "邮件正文生成完整");
  console.log("自检通过：" + subject);
} else {
  process.stdout.write(JSON.stringify(out));
}
