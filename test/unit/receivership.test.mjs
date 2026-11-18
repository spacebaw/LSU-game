// Unit test for the unstick pass, receivership (the playtester: "Got to a point of 'receivership', no idea what it was, wasn't able to get out …
// does not let build at all … soft-locks game"). On a campus that spends more than it earns:
//  (1) economy.budget: the average month (pure; the levers move it at once: the bulldozer, tuition, faculty, coaching);
//  (2) the standing warning before anything happens: in debt and losing money → progress.receivership() phase 'deficit', the chip, its dialog;
//  (3) the Board's card says why it came and what "Not now" starts; "Not now" = the 60-day deadline: the chip counts it down, the dialog has the
//      levers, the Board's offers can be reopened (keeping the deadline changes nothing, taking one drops it); cash at $0 on the day lifts it;
//  (4) entry: the debt written off, prestige −20, Faculty to Basic, Coaching to $0, auto-repair on, 4×; the dialog opens once, by itself, with the
//      real numbers, what is frozen, what still works, how long, what is true at the end, one "Got it"; the Board's card does not come back on top;
//  (5) the chip while it lasts, with the days left; a click reopens the dialog;
//  (6) every refusal reads "Receivership: N days left" (canPlace, upgrade, pilings, regrade, land; the ghost label and the snackbar through
//      ui.pointer); what is never frozen: the bulldozer, Gravel Path and Boardwalk, repairs, every Budget control;
//  (7) exit after receiverTermDays: cash $0 or better (a positive balance is kept), the player's speed and auto-repair setting back, the Board's
//      counter restarted, the exit dialog, the standing warning while the campus is still short;
//  (8) no loop: three years with every Board card answered "Not now": never back to back, each later receivership behind a Board card and a
//      60-day countdown, the chip up on every day in debt and losing money; a player who takes the lever the dialog names never goes back; a
//      campus whose gap was what the Board cut never goes back;
//  (9) save / load in the middle; a save without the new keys; the CSS (tokens only, the cap).
// Usage: node build.mjs --check && node test/unit/receivership.test.mjs   (exit 1 on any failure)
import { loadGame } from '../domstub.mjs';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));

let failures = 0, passes = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else { passes++; console.log('ok  :', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const { win } = loadGame();
const BSU = win.BSU, U = BSU.ui, PR = BSU.progress, B = BSU.buildings, H = BSU.headless, EC = BSU.economy, LD = BSU.land, SS = BSU.session;
const FL = BSU.params.econ.failure, PE = BSU.params.econ, NOTICE = FL.receiverDays, TERM = FL.receiverTermDays;
const M0 = { ctrl: false, shift: false, meta: false, alt: false };
const errs = () => [...BSU.errors.keys()];
const money = (n) => BSU.formatMoney(n);
const deepText = (el) => !el ? '' : (el.children && el.children.length ? el.children.map(deepText).join(' | ') : String(el.textContent || ''));
const click = (el) => el.dispatchEvent({ type: 'click' });
const findAll = (el, pred, out = []) => { if (!el) return out; if (pred(el)) out.push(el); for (const c of (el.children || [])) findAll(c, pred, out); return out; };
const shown = (el) => { for (let e = el; e; e = e.parentNode) if (e.classList && e.classList.contains('hidden')) return false; return true; };
const chip = () => shown(U.el['board-chip']) ? U.el['board-chip-text'].textContent : '';
const dialog = () => U.cardOpen() ? { id: U.cardOpen(), text: deepText(U.el.cards.children[0]).replace(/\u2060/g, ''), buttons: findAll(U.el.cards.children[0], (e) => e.tagName === 'BUTTON') } : null;
const button = (label) => { const d = dialog(); return d ? d.buttons.find((b) => b.textContent.indexOf(label) === 0) || null : null; };
/** the frames a player sees: the HUD re-reads the Board's state twice a second */
const frame = (s) => { U.update(s, 600); U.update(s, 600); };
const fail = (s) => s.progress.failure;
/** every snackbar text since the last notes.length = 0 (snackbars time out or make room for news lines) */
const notes = []; { const n0 = U.notify; U.notify = function (st, spec) { if (spec && spec.text) notes.push(spec.text); return n0.apply(this, arguments); }; }
const snap = (s) => JSON.stringify([s.progress.failure, s.economy, s.ui.speed, s.ui.tool, s.ui.panel, s.ui.camera, s.calendar.day, s.ticker.length, s.buildings.length]);

const COSTLY = ['dining_hall', 'lecture_hall', 'library', 'engineering', 'union', 'rec_center', 'health_center', 'coastal_institute', 'bell_tower', 'tiger_habitat', 'practice_field'];
/** a campus that spends more than it earns: eleven costly buildings, no dorm (120 students), placed through the game's own validation */
function deficitCampus({ cash = -1900000, quality = 'elite', coaching = 600000, ids = COSTLY } = {}) {
  SS.newGame({ seed: 42, skipTutorial: true, size: 96 }); U.showTitle(false);
  const s = BSU.state, keep = { u: PR.unlocked, o: PR.unlockOk };
  s.economy.cash = 1e9; PR.unlocked = () => ({ ok: true }); PR.unlockOk = () => true;
  for (const id of ids) { const p = H.findSpot(id); if (p) H.place(id, p.x, p.y); }
  H.fastForwardDays(20); PR.unlocked = keep.u; PR.unlockOk = keep.o;
  while (s.setPiece) H.fastForwardDays(1);
  U.dismissNotifs(); while (U.cardOpen()) U.closeCard();
  s.economy.cash = cash; EC.setQuality(s, quality); EC.setCoaching(s, coaching);
  frame(s);
  return s;
}
/** the cards that are not the Board's (season recaps, Board proposals, probation) are closed as a player would close them */
function calm(s) { for (let k = 0; k < 6; k++) { const c = U.cardOpen(); if (!c || c === 'receiver' || (c === 'failure' && fail(s).pendingKind === 'bankruptcy')) break; if (c === 'failure') PR.answerFailure(s, fail(s).pendingKind, 'ok'); U.closeCard(); } }
/** run day by day until pred(s) (calm in between); the days run, or -1 */
function runUntil(s, pred, max) { for (let d = 1; d <= max; d++) { H.fastForwardDays(1); calm(s); if (pred(s)) return d; } return -1; }
const boardCard = (s) => U.cardOpen() === 'failure' && fail(s).pendingKind === 'bankruptcy';
/** to the Board's card, "Not now", and on to the day receivership starts */
function intoReceivership(s) {
  const d1 = runUntil(s, boardCard, 80); if (d1 < 0) return false;
  click(button('Not now'));
  return runUntil(s, (x) => fail(x).receiver === true, NOTICE + 40) > 0;   // a set piece freezes the calendar, so 60 calendar days can take more than 60 days of ticks
}

// --- (1) the average month -------------------------------------------------------------------------------------------------------------
console.log('--- (1) economy.budget ---');
let s = deficitCampus();
{
  const b = EC.budget(s);
  ok(b && Number.isFinite(b.income) && Number.isFinite(b.costs) && b.net === b.income - b.costs && b.lines && b.lines.income && b.lines.costs, 'budget → {income, costs, net, lines} (' + JSON.stringify({ income: b.income, costs: b.costs }) + ')');
  const sumI = Object.values(b.lines.income).reduce((a, v) => a + v, 0), sumC = Object.values(b.lines.costs).reduce((a, v) => a + v, 0);
  ok(sumI === b.income && sumC === b.costs, 'the lines add up to the totals');
  eq(b.lines.income.tuition, Math.round(s.economy.students * s.economy.tuition * PE.installmentShare * PE.installments.length / 12), 'tuition: four installments of half the fee, a twelfth a month');
  eq(b.lines.costs.upkeep, B.upkeepTotal(s), 'upkeep is buildings.upkeepTotal');
  eq(b.lines.costs.interest, Math.round(-s.economy.cash * PE.interest), 'loan interest on today\'s balance');
  ok(b.net < -150000, 'this campus loses money every month (' + b.net + ')');
  const before = snap(s); EC.budget(s); PR.receivership(s); PR.receiverBrief(s); PR.receiverBrief(s, 'exit');
  ok(snap(s) === before, 'budget, receivership and receiverBrief change nothing');
  // the levers move it at once
  const eng = B.list(s, 'engineering')[0], up = BSU.data.catalog.engineering.upkeep;
  EC.setQuality(s, 'basic'); const b1 = EC.budget(s);
  eq(b.lines.costs.salaries - b1.lines.costs.salaries, Math.round(s.economy.students * PE.salaryPerStudent * (PE.qualityMult.elite - 1)), 'Faculty to Basic takes the Elite premium off the salaries');
  EC.setCoaching(s, 0); const b2 = EC.budget(s);
  eq(b1.lines.costs.coaching - b2.lines.costs.coaching, 50000, 'Coaching spend $600k a year → $0: $50k a month');
  EC.setTuition(s, s.economy.tuition + 250); const b3 = EC.budget(s);
  eq(b3.lines.income.tuition - b2.lines.income.tuition, Math.round(s.economy.students * 250 * 2 / 12), 'one tuition step: students × $250 × 2 / 12 a month');
  const r = B.remove(s, eng.id); const b4 = EC.budget(s);
  ok(r.ok && r.refund === Math.round(BSU.data.catalog.engineering.cost * PE.demolishRefund) && b3.lines.costs.upkeep - b4.lines.costs.upkeep === up, 'the bulldozer: 40% back and the upkeep gone from the next reading ($' + up + ')');
  ok(b4.net > b.net, 'net ' + b.net + ' → ' + b4.net);
}

// --- (2) the standing warning ----------------------------------------------------------------------------------------------------------
console.log('--- (2) in debt and losing money ---');
s = deficitCampus();
{
  const r = PR.receivership(s), b = EC.budget(s);
  ok(r.phase === 'deficit' && r.net === b.net && r.cash === -1900000 && r.tone === 'warn', 'phase deficit with the average month\'s numbers');
  eq(r.chip, 'Losing ' + money(-b.net) + ' a month', 'the chip text');
  eq(chip(), r.chip, 'the chip is on screen');
  eq(U.el['board-chip'].dataset.tone, 'warn', 'the chip\'s tone');
  ok(/what it means and what fixes it/.test(U.el['board-chip'].getAttribute('aria-label') || ''), 'the chip has an accessible name');
  const br = PR.receiverBrief(s);
  ok(br.phase === 'deficit' && br.title === 'Costs exceed income by ' + money(-b.net) + ' a month', 'the dialog\'s title is the gap');
  ok(/into the \$2M loan line/.test(br.lead) && /3 months past the line and the Board of Regents steps in/.test(br.lead) && /Nothing is frozen now/.test(br.lead), 'the lead: the loan line, the Board, nothing frozen yet');
  ok(br.facts.some((f) => f.k === 'Cash today' && f.v === money(-1900000) && f.bad) && br.facts.some((f) => f.k === 'Income, an average month' && f.v === money(b.income)) && br.facts.some((f) => f.k === 'Costs, an average month' && f.v === money(b.costs)) && br.facts.some((f) => f.k === 'Short every month' && f.v === money(-b.net)), 'the facts: cash, income, costs, the gap');
  const lv = br.sections[0].lines;
  const staff = BSU.sports.staffSalaryMonthly(s);
  ok(br.sections[0].title === 'What closes the gap' && lv.length === 3 && /^Budget: set Faculty to Basic\. Saves \$\d+k a month\.$/.test(lv[0]) && /^Budget: cut Coaching spend\. Up to \$50k a month\.$/.test(lv[1]), 'three levers with today\'s numbers: ' + lv.join(' / '));
  ok(staff > 30000 && lv[2] === 'Bulldozer: sell what you can spare. 40% of the price comes back at once and the upkeep ends. Your costliest: Practice Field (its football program goes too), ' + money(3000 + staff) + ' a month, $80k back.', 'the bulldozer lever names what saves the most a month: the one field, with the coaching staff it carries ($' + staff + ' a month)');
  click(U.el['board-chip']);
  let d = dialog();
  ok(d && d.id === 'receiver' && d.text.indexOf(br.title) >= 0 && d.text.indexOf(lv[2]) >= 0, 'a click on the chip opens the explanation');
  ok(d.buttons.length === 2 && d.buttons[0].textContent === 'Got it' && d.buttons[1].textContent === 'Open Budget', 'Got it · Open Budget');
  click(button('Open Budget')); ok(U.cardOpen() === null && U.panel() === 'budget', 'Open Budget opens the Budget panel'); U.openPanel(null);
  // not in debt, or not losing money: no chip
  s.economy.cash = 500000; frame(s); ok(PR.receivership(s).phase === 'none' && chip() === '', 'cash above $0: no chip (losing money with cash in hand is the Cash chip\'s red dot)');
  s.economy.cash = -1900000; s.economy.students = 1500; frame(s); ok(EC.budget(s).net > 0 && PR.receivership(s).phase === 'none' && chip() === '', 'in debt but earning more than it spends: no chip');
  ok(PR.receiverBrief(s) === null, 'no brief when there is nothing to explain');
  eq(errs().length, 0, 'no errors');
}

// --- (3) the Board's card and its deadline ---------------------------------------------------------------------------------------------
console.log('--- (3) the Board\'s card, "Not now", the deadline ---');
s = deficitCampus();
{
  const d1 = runUntil(s, boardCard, 80);
  ok(d1 > 0 && s.economy.negMonths >= PE.bankruptMonths && s.economy.cash < -PE.loanLimit, 'the Board\'s card after ' + PE.bankruptMonths + ' months past the loan line (day ' + s.calendar.day + ', cash ' + s.economy.cash + ')');
  let d = dialog(); const b = EC.budget(s);
  ok(/Board of Regents/.test(d.text) && /Cash has been past the \$2M loan line for 3 months\./.test(d.text) && d.text.indexOf('an average month brings in ' + money(b.income) + ' and costs ' + money(b.costs)) >= 0, 'the card says why it came, with the numbers');
  ok(/Not now: the Board checks your cash in 60 days\. Below \$0 then, it runs the budget for 30 days \(receivership: no new buildings, prestige −20\)\./.test(d.text), 'and what "Not now" starts');
  eq(d.buttons.map((x) => x.textContent).join(' / '), 'Austerity / Emergency Tuition Hike / Sell Naming Rights / Not now: 60 days to fix it', 'the buttons carry the option names');
  ok(U.keydown('Escape', M0) === true && U.cardOpen() === 'failure', 'the card is modal');
  const day0 = s.calendar.day;
  click(button('Not now')); frame(s);
  ok(U.cardOpen() === null && fail(s).receiverUntilDay === day0 + NOTICE && fail(s).receiver === false && fail(s).bankruptcy === 1 && fail(s).pendingKind === null, '"Not now" starts the ' + NOTICE + '-day deadline');
  const sn = U._snacks().visible.map((x) => x.text);
  ok(sn.some((t) => t === 'The Board checks your cash on ' + BSU.formatDate(day0 + NOTICE) + ' (60 days). Below $0 then means receivership.'), 'a snackbar names the day and the consequence');
  let r = PR.receivership(s);
  ok(r.phase === 'notice' && r.daysLeft === NOTICE && r.untilDay === day0 + NOTICE && r.tone === 'danger', 'phase notice');
  eq(chip(), 'Board deadline · 60 days', 'the chip has the countdown'); eq(U.el['board-chip'].dataset.tone, 'danger', 'in the danger tone while cash is below $0');
  H.fastForwardDays(7); calm(s); frame(s);
  const left = day0 + NOTICE - s.calendar.day;
  ok(left < NOTICE && left >= NOTICE - 7, 'days pass (' + left + ' left)');
  eq(chip(), 'Board deadline · ' + left + ' days', 'the countdown follows the calendar');
  const br = PR.receiverBrief(s);
  ok(br.phase === 'notice' && br.title === left + ' days to get cash back to $0', 'the dialog\'s title is the countdown');
  ok(br.lead.indexOf('On ' + BSU.formatDate(day0 + NOTICE) + ' it checks your cash.') >= 0 && /At \$0 or more it backs off\. Below \$0 it takes over for 30 days: that is receivership/.test(br.lead), 'the lead: the day, the test, the consequence');
  const lv = br.sections[0].lines;
  ok(/The most cash: Engineering Hall, \$1\.04M back, \$30k a month saved\.$/.test(lv[0]), 'for the deadline the bulldozer lever names what pays the most back at once (' + lv[0].slice(-70) + ')');
  ok(br.sections[0].title === 'What gets you there' && /^Bulldozer: /.test(lv[0]) && /^The Board's offers still stand: Austerity, a Tuition Hike, or Naming Rights \(\$1M at once\)\. Taking one drops the deadline\.$/.test(lv[1]) && /^Budget: /.test(lv[2]) && lv.length === 3, 'the levers lead with what raises cash at once: ' + lv.map((x) => x.slice(0, 22)).join(' / '));
  click(U.el['board-chip']); d = dialog();
  eq(d.buttons.map((x) => x.textContent).join(' / '), 'Got it / Open Budget / The Board\'s offers', 'the deadline dialog\'s buttons');
  // the offers again: keeping the deadline changes nothing
  const before = JSON.stringify([fail(s).receiverUntilDay, fail(s).bankruptcy, s.economy.cash, s.economy.tuition, s.progress.timers.length]);
  click(button('The Board\'s offers')); d = dialog();
  ok(d && d.id === 'failure' && fail(s).pendingKind === 'bankruptcy' && /The Board's deadline is /.test(d.text) && /Taking an offer drops the deadline\./.test(d.text), 'The Board\'s offers reopens its card (pending at once: its buttons work while paused)');
  eq(d.buttons[3].textContent, 'Keep my deadline', 'the last button keeps the deadline');
  click(button('Keep my deadline'));
  ok(U.cardOpen() === null && fail(s).pendingKind === null && JSON.stringify([fail(s).receiverUntilDay, fail(s).bankruptcy, s.economy.cash, s.economy.tuition, s.progress.timers.length]) === before, 'Keep my deadline changes nothing');
  // an offer taken during the notice drops the deadline, as if it had been picked on the first card
  const cash0 = s.economy.cash; PR.boardOffers(s); click(button('Sell Naming Rights')); frame(s);
  ok(s.economy.cash === cash0 + FL.namingRights && fail(s).receiverUntilDay === -1 && fail(s).bankruptcy === 1 && fail(s).pendingKind === null, 'Naming Rights during the notice: +$1M, the deadline dropped, the bankruptcy count unchanged');
  ok(PR.receivership(s).phase === 'deficit' && /^Losing /.test(chip()), 'the chip goes back to the standing warning');
  ok(PR.boardOffers(s) === false, 'no offers to reopen without a deadline');
  eq(errs().length, 0, 'no errors');
}
// cash at $0 or better on the day: the deadline is lifted
s = deficitCampus();
{
  runUntil(s, boardCard, 80); click(button('Not now'));
  const until = fail(s).receiverUntilDay;
  H.fastForwardDays(20); calm(s); s.economy.cash = 400000; frame(s);
  ok(PR.receivership(s).phase === 'notice' && PR.receivership(s).tone === 'ok' && /^Board check in \d+ days · on track$/.test(chip()), 'cash above $0 during the notice: "on track" (' + chip() + ')');
  ok(/^On track: the Board checks in \d+ days$/.test(PR.receiverBrief(s).title), 'and the dialog says so');
  notes.length = 0;
  while (s.calendar.day < until) { H.fastForwardDays(1); calm(s); if (s.economy.cash < 300000) s.economy.cash = 400000; }
  frame(s);
  ok(fail(s).receiver === false && fail(s).receiverUntilDay === -1 && U.cardOpen() !== 'failure', 'on the deadline with cash at $0 or better the Board backs off (no receivership, no card)');
  ok(notes.some((x) => x === 'Cash is at $0 or better on the Board\'s deadline: the Board backs off.'), 'and says so');
  ok(PR.receivership(s).phase === 'none' || PR.receivership(s).phase === 'deficit', 'the deadline is off the chip');
}

// --- (4) entry -------------------------------------------------------------------------------------------------------------------------
console.log('--- (4) receivership starts ---');
s = deficitCampus();
let entryDay = -1, entryCash = 0, entryBudget = null, prestige0 = 0;
{
  runUntil(s, boardCard, 80); click(button('Not now'));
  const until = fail(s).receiverUntilDay;
  while (s.calendar.day < until - 1) { H.fastForwardDays(1); calm(s); }
  entryCash = s.economy.cash; prestige0 = s.economy.prestige; s.economy.autoRepair = false; SS.setSpeed(s, 2);   // the player's own settings: auto-repair off, 2×
  // the last day of the notice, a tick at a time, to read the numbers the Board finds
  const TPD = BSU.params.time.ticksPerDay; let guard = 0;
  while (!fail(s).receiver && guard++ < TPD + 5) { entryCash = s.economy.cash; prestige0 = s.economy.prestige; entryBudget = EC.budget(s); H.tick(1); }
  entryDay = s.calendar.day; frame(s);
  const f = fail(s);
  ok(f.receiver === true && entryDay === until && f.receiverUntilDay === entryDay + TERM, 'receivership starts on the deadline and lasts ' + TERM + ' days (was 120)');
  eq(TERM, 30, 'receiverTermDays');
  ok(PR.receiverActive(s) === true, 'receiverActive');
  eq(s.economy.cash, 0, 'the debt is written off on day one');
  ok(Math.abs(s.economy.prestige - (prestige0 - FL.receiverPrestige)) < 1.5, 'prestige −' + FL.receiverPrestige + ' (' + prestige0.toFixed(1) + ' → ' + s.economy.prestige.toFixed(1) + ')');
  ok(s.economy.quality === 'basic' && s.economy.coaching === 0, 'the Board\'s cuts: Faculty to Basic, Coaching spend to $0');
  ok(s.economy.autoRepair === true && s.ui.speed === FL.receiverSpeed, 'auto-repair on, ' + FL.receiverSpeed + '×');
  ok(s.economy.negMonths === 0 && f.pendingKind === null, 'the Board\'s counter restarts; no card left pending');
  const br0 = f.brief;
  // (the month's charges post in the same tick, before the Board looks: the cash it finds is the tick before's less that month's costs)
  ok(br0 && br0.day === entryDay && br0.cash < 0 && br0.cash <= Math.round(entryCash) && entryCash - br0.cash < 600000 && br0.wrote === -br0.cash && br0.speedBefore === 2 && br0.autoRepairBefore === false, 'the brief keeps what the Board found: cash ' + br0.cash + ' (' + Math.round(entryCash) + ' the tick before), the speed and auto-repair setting to give back');
  ok(Math.abs(br0.income - entryBudget.income) < 0.05 * entryBudget.income && Math.abs(br0.costs - entryBudget.costs) < 0.05 * entryBudget.costs && br0.costs > br0.income, 'and the average month of that day (' + br0.income + ' in, ' + br0.costs + ' out)');
  entryCash = br0.cash;
  ok(br0.cuts.length === 2 && br0.cuts[0].id === 'faculty' && br0.cuts[0].saving === Math.round(s.economy.students * PE.salaryPerStudent * (PE.qualityMult.elite - 1)) && br0.cuts[1].id === 'coaching' && br0.cuts[1].saving === 50000, 'the cuts with what each saves a month');
  // the dialog: by itself, once, the Board's own card not on top of it
  const d = dialog();
  ok(d && d.id === 'receiver', 'the dialog opens by itself (and the Board\'s card is not on top of it)');
  ok(/Board of Regents \| Receivership: 30 days left/.test(d.text), 'its title');
  ok(d.text.indexOf('on ' + BSU.formatDate(entryDay) + ', the Board\'s deadline, cash was still below $0. The Board of Regents runs the budget for 30 days.') >= 0, 'what it is and why, in one sentence');
  ok(d.text.indexOf('Cash on ' + BSU.formatDate(entryDay) + ' | ' + money(Math.round(entryCash))) >= 0 && d.text.indexOf('Income, an average month | ' + money(br0.income)) >= 0 && d.text.indexOf('Costs, an average month | ' + money(br0.costs)) >= 0, 'the real numbers: cash on the day, the average month\'s income against its costs');
  ok(d.text.indexOf('The Board leaves | ' + BSU.formatDate(entryDay + TERM) + ' · 30 days') >= 0, 'how long: the day it ends');
  ok(d.text.indexOf('Paid off the debt: cash went from ' + money(Math.round(entryCash)) + ' to $0. Prestige −20.') >= 0 && /Faculty set to Basic: saves \$\d+k a month\. Budget puts it back\./.test(d.text) && /Coaching spend cut to \$0: saves \$50k a month\. Budget puts it back\./.test(d.text), 'what the Board did, each cut with its saving');
  ok(/Time set to 4×: the 30 days pass in about 5 minutes\. The speed buttons still work\./.test(d.text), 'the forced speed is said (and how long it takes)');
  ok(/Frozen until it leaves \| New buildings, upgrades, pilings and land\./.test(d.text), 'what is frozen');
  ok(/Still yours \| The bulldozer \(40% of the price back, and the upkeep ends\), Gravel Path and Boardwalk\. \| Repairs, storm prep and Budget: tuition, faculty, coaching, insurance\./.test(d.text), 'what still works');
  ok(/When it ends \| Every tool comes back, with cash at \$0 or better and the full \$2M loan line\./.test(d.text) && /Today the campus is still short \$\d+k a month\. Close that gap or the debt returns, and the Board with it\./.test(d.text), 'what is true at the end, and that the gap is still open');
  ok(d.buttons.length === 1 && d.buttons[0].textContent === 'Got it', 'one button: Got it');
  ok(U.el.cards.children[0].getAttribute('role') === 'dialog' && U.el.cards.children[0].getAttribute('aria-modal') === 'true', 'it is a dialog');
  click(button('Got it')); ok(U.cardOpen() === null, 'Got it closes it');
  H.fastForwardDays(2); calm(s); frame(s);
  ok(U.cardOpen() === null, 'it does not come back on its own (once per receivership)');
  eq(errs().length, 0, 'no errors');
}

// --- (5) the chip ----------------------------------------------------------------------------------------------------------------------
console.log('--- (5) the chip while it lasts ---');
{
  const left = fail(s).receiverUntilDay - s.calendar.day;
  eq(chip(), 'Receivership · ' + left + ' days left', 'the chip has the days left');
  eq(U.el['board-chip'].dataset.tone, 'danger', 'in the danger tone');
  const r = PR.receivership(s); ok(r.phase === 'receiver' && r.daysLeft === left && r.untilDay === fail(s).receiverUntilDay, 'phase receiver');
  H.fastForwardDays(1); calm(s); frame(s); eq(chip(), 'Receivership · ' + (left - 1) + ' days left', 'it counts down');
  const cam = JSON.stringify(s.ui.camera);
  click(U.el['board-chip']); const d = dialog();
  ok(d && d.id === 'receiver' && d.text.indexOf('Receivership: ' + (left - 1) + ' days left') >= 0 && d.text.indexOf('Cash on ' + BSU.formatDate(entryDay) + ' | ' + money(Math.round(entryCash))) >= 0, 'a click reopens the explanation with the days left and the same numbers');
  ok(JSON.stringify(s.ui.camera) === cam, 'no camera move');
  click(U.el['board-chip']); ok(dialog().id === 'receiver', 'a second click does not stack a second dialog'); click(button('Got it')); ok(U.cardOpen() === null, 'closed');
}

// --- (6) refusals, and what is never frozen --------------------------------------------------------------------------------------------
console.log('--- (6) refusals and what still works ---');
{
  const left = fail(s).receiverUntilDay - s.calendar.day, why = 'Receivership: ' + left + ' days left';
  eq(PR.receiverRefusal(s), why, 'receiverRefusal');
  const p = H.findSpot('dorm') || { x: 40, y: 40 };
  for (const id of ['dorm', 'dining_hall', 'road', 'bridge', 'levee', 'live_oak', 'preserve', 'pilings', 'substation']) eq(B.canPlace(s, id, p.x, p.y, {}).reason, why, id + ' is refused with the days left');
  ok(!/Receivership/.test(B.canPlace(s, 'path', p.x, p.y, {}).reason) && !/Receivership/.test(B.canPlace(s, 'boardwalk', p.x, p.y, {}).reason), 'Gravel Path and Boardwalk are not');
  ok(!/Receivership/.test(B.canPlace(s, 'pump', p.x, p.y, { ignoreCash: true, instant: true }).reason) && B.canPlace(s, 'pump', p.x, p.y, { ignoreCash: true }).reason === why, 'a free delivery (ignoreCash + instant: the Coastal Resilience Grant\'s pump) is not frozen; ignoreCash alone is');
  eq(PR.receiverRefusal(s, 'path'), '', 'receiverRefusal(path) is empty'); eq(PR.receiverRefusal(s, 'boardwalk'), '', 'receiverRefusal(boardwalk) is empty'); eq(JSON.stringify(FL.receiverAllow), '["path","boardwalk"]', 'params.econ.failure.receiverAllow');
  const pf = B.list(s, 'practice_field')[0], uq = B.upgradeQuote(s, pf.id);
  ok(uq.ok === false && uq.reason === why && B.upgrade(s, pf.id).reason === why, 'an upgrade is refused with the days left');
  const hall = B.list(s, 'lecture_hall')[0];
  eq(B.retrofitPilings(s, hall.id).reason, why, 'pilings are refused'); eq(B.regrade(s, hall.id).reason, why, 'a regrade is refused');
  const sec = LD.sections(s).find((x) => x.forSale && !x.owned); s.economy.cash = 9e6;
  ok(sec && LD.quote(s, sec.id).ok === false && LD.quote(s, sec.id).reason === why && LD.buy(s, sec.id).ok === false, 'the Land Office is refused (with the cash for it)'); s.economy.cash = 0;
  // through the UI: the ghost label, then one click → the snackbar with "Why?", the tool dropped
  U.dismissNotifs(); U.selectTool(s, 'dining_hall');
  const px = BSU.render.tileToScreen(p.x, p.y); U.pointer('move', px.x, px.y, 0, M0); frame(s);
  ok(shown(U.el['ghost-label']) && deepText(U.el['ghost-label']).indexOf(why) >= 0, 'the ghost label says it before the click (' + deepText(U.el['ghost-label']) + ')');
  const n0 = B.list(s).length; U.pointer('down', px.x, px.y, 0, M0); U.pointer('up', px.x, px.y, 0, M0); frame(s);
  ok(B.list(s).length === n0 && U.tool() === null, 'the click builds nothing and drops the tool (one click ends a placement)');
  ok(U._snacks().visible.some((x) => x.text === 'Dining Hall: ' + why), 'the snackbar repeats it: "Dining Hall: ' + why + '"');
  const whyBtn = findAll(U.el.notifications, (e) => e.tagName === 'BUTTON' && e.textContent === 'Why?')[0];
  ok(!!whyBtn, 'with a "Why?" button'); click(whyBtn); ok(U.cardOpen() === 'receiver', '"Why?" opens the explanation'); U.closeCard();
  // never frozen: a path, the bulldozer, repairs, Budget
  const W = BSU.MAP.W; let run = null;
  for (let y = 4; y < BSU.MAP.H - 4 && !run; y++) for (let x = 4; x < W - 6; x++) { const t = [y * W + x, y * W + x + 1, y * W + x + 2], q = B.runQuote(s, 'path', t, { noTie: true }); if (q && q.placed === 3 && !(q.refused && q.refused.length)) { run = t; break; } }
  const c0 = s.economy.cash, pr = B.placeRun(s, 'path', run, { noTie: true });
  ok(pr.placed === 3 && s.economy.cash === c0 - 3 * BSU.data.catalog.path.cost, 'a Gravel Path is laid (the loan line pays: cash ' + c0 + ' → ' + s.economy.cash + ')');
  const eng = B.list(s, 'engineering')[0], net0 = EC.budget(s).net, c1 = s.economy.cash, rm = B.remove(s, eng.id);
  ok(rm.ok && s.economy.cash === c1 + rm.refund && rm.refund === 1040000 && EC.budget(s).net > net0, 'the bulldozer takes the Engineering Hall: $1.04M back, the average month better at once');
  ok(EC.setTuition(s, 7000) === true && s.economy.tuition === 7000, 'tuition can be set');
  EC.setQuality(s, 'good'); ok(s.economy.quality === 'good', 'Faculty can be set (the Board\'s cut is a setting, not a lock)'); EC.setQuality(s, 'basic');
  const lh = B.list(s, 'lecture_hall')[0]; lh.hp = 0.5; const rep = B.repair(s, lh.id);
  ok(rep && rep.ok === true && lh.hp === 1, 'a repair goes through');
  ok(B.repairAll(s).reason !== why && !/Receivership/.test(String(B.repairAll(s).reason || '')), 'Repair All is not refused');
  // the last day reads "1 day left"
  while (fail(s).receiverUntilDay - s.calendar.day > 1) { H.fastForwardDays(1); calm(s); }
  frame(s);
  eq(PR.receiverRefusal(s), 'Receivership: 1 day left', 'the last day: "1 day left"'); eq(chip(), 'Receivership · 1 day left', 'on the chip too');
  eq(errs().length, 0, 'no errors');
}

// --- (7) exit --------------------------------------------------------------------------------------------------------------------------
console.log('--- (7) the end ---');
{
  const cashBefore = s.economy.cash;   // positive: the Engineering Hall's refund is the player's
  // a set piece in the middle overwrote what session remembered of the speed: the player's 2× still comes back
  s.ui.speedBefore = 4;
  const d = runUntil(s, (x) => fail(x).receiver === false, 5); frame(s);
  ok(d === 1 && s.calendar.day === entryDay + TERM, 'it ends ' + TERM + ' days after it started');
  ok(fail(s).receiverUntilDay === -1 && PR.receiverActive(s) === false && PR.receiverRefusal(s) === '', 'nothing is refused any more');
  ok(s.economy.cash > 0 && Math.abs(s.economy.cash - cashBefore) < 400000, 'a positive balance is kept (it used to be zeroed): ' + cashBefore + ' → ' + s.economy.cash);
  eq(s.ui.speed, 2, 'the player\'s own speed is back (2×), whatever a set piece left in speedBefore');
  eq(s.economy.autoRepair, false, 'the player\'s auto-repair setting is back (off)');
  eq(s.economy.negMonths, 0, 'the Board\'s counter starts from zero');
  const dl = dialog(), b = EC.budget(s);
  ok(dl && dl.id === 'receiver' && /Board of Regents \| The Board has left/.test(dl.text) && /Receivership is over\. Every tool is back, the old debt is gone and the \$2M loan line is open again\./.test(dl.text), 'the exit dialog');
  ok(dl.buttons.length === 1 && dl.buttons[0].textContent === 'Got it', 'one button');
  ok(b.net < 0 && dl.text.indexOf('Costs still exceed income by ' + money(-b.net) + ' a month.') >= 0 && /At that rate the loan line lasts \d+ months; 3 months past it, the Board is back\. The warning stays up until the gap is closed\./.test(dl.text), 'still short: the dialog says by how much and how long the loan line lasts');
  ok(fail(s).watch === true && PR.receivership(s).phase === 'deficit', 'the standing warning is on although cash is above $0');
  click(button('Got it')); frame(s);
  eq(chip(), 'Losing ' + money(-b.net) + ' a month', 'the chip: "Losing … a month"');
  ok(/^Cash covers about \d+ months? at this rate, then the \$2M loan line\./.test(PR.receiverBrief(s).lead), 'its dialog counts the months the cash covers');
  ok(B.canPlace(s, 'dorm', H.findSpot('dorm').x, H.findSpot('dorm').y, {}).ok === true, 'a Dorm can be built again');
  // the gap closed: the warning goes
  s.economy.students = 1500; H.fastForwardDays(1); calm(s); frame(s);
  ok(fail(s).watch === false && PR.receivership(s).phase === 'none' && chip() === '', 'the warning goes when the average month stops losing money');
  eq(errs().length, 0, 'no errors');
}
// the other endings: the debt that ran up under the Board is covered; a speed the player chose is left alone; auto-repair on stays on; balanced books
s = deficitCampus();
{
  ok(intoReceivership(s), 'a second campus into receivership');
  ok(!!dialog() && dialog().id === 'receiver', 'its dialog'); if (button('Got it')) click(button('Got it'));
  SS.setSpeed(s, 8);   // the player's own choice during receivership
  runUntil(s, (x) => fail(x).receiver === false, TERM + 2);
  eq(s.economy.cash, 0, 'what ran up while the Board was in charge is covered: cash is $0, not below');
  eq(s.ui.speed, 8, 'a speed the player chose during receivership is left alone');
  eq(s.economy.autoRepair, true, 'auto-repair was on before: it stays on');
  ok(dialog().id === 'receiver' && U.cardOpen() !== 'failure', 'the exit dialog, and no Board card on the day it ends');
}

// --- (8) no loop -----------------------------------------------------------------------------------------------------------------------
console.log('--- (8) three years on: never back to back ---');
/** run `daysN` days; the player answers every Board card with `answer` and reads every dialog; `each(s)` runs once a day. Returns the log */
function years(s, daysN, { answer = 'Not now', each = null } = {}) {
  const out = { entries: [], exits: [], cards: [], uncovered: 0, staleCards: 0, stalePending: 0, gaps: [], unannounced: 0 };
  let last = fail(s).receiver, lastExit = last ? -1 : s.calendar.day, cardSince = false, noticeDays = 0;
  for (let d = 0; d < daysN; d++) {
    H.fastForwardDays(1); calm(s);
    if (boardCard(s)) { out.cards.push(s.calendar.day); cardSince = true; const b = button(answer); if (b) click(b); else U.closeCard(); }
    const f = fail(s), r = PR.receivership(s);
    if (f.receiver !== last) {
      if (U.cardOpen() === 'failure') out.staleCards++;   // the Board's card on top of the day receivership starts or ends
      if (f.receiver) { out.entries.push(s.calendar.day); if (lastExit >= 0) out.gaps.push(s.calendar.day - lastExit); if (!cardSince || noticeDays < NOTICE - 1) out.unannounced++; }
      else { out.exits.push(s.calendar.day); lastExit = s.calendar.day; cardSince = false; }
      noticeDays = 0; last = f.receiver;
    }
    if (U.cardOpen() === 'receiver') click(button('Got it'));
    if (r.phase === 'notice') noticeDays++;
    if (f.receiver && f.pendingKind) out.stalePending++;
    if (s.economy.cash < 0 && r.net < 0 && r.phase === 'none') out.uncovered++;
    if (each) each(s);
  }
  return out;
}
s = deficitCampus({ quality: 'basic', coaching: 0 });   // nothing for the Board to cut: the gap is the buildings
{
  ok(intoReceivership(s), 'into receivership'); click(button('Got it'));
  const log = years(s, 3 * 120 + TERM);
  console.log('     entries ' + JSON.stringify(log.entries) + ' exits ' + JSON.stringify(log.exits) + ' Board cards ' + JSON.stringify(log.cards) + ' gaps ' + JSON.stringify(log.gaps));
  ok(log.exits.length >= 1, 'the first receivership ended');
  ok(log.entries.length >= 1, 'a player who answers every card "Not now" and changes nothing does meet the Board again (' + log.entries.length + ' more in three years): it is still the bankruptcy consequence');
  ok(log.gaps.every((g) => g >= PE.bankruptMonths * BSU.params.time.daysPerMonth + NOTICE), 'never back to back: at least ' + (PE.bankruptMonths * BSU.params.time.daysPerMonth + NOTICE) + ' days (3 months past the loan line + the 60-day deadline) between an end and the next start (' + log.gaps.join(', ') + ')');
  eq(log.unannounced, 0, 'every later receivership came behind a Board card and its full 60-day countdown');
  eq(log.uncovered, 0, 'no day in debt and losing money without the chip');
  eq(log.staleCards, 0, 'the Board\'s card never sits on the day receivership starts or ends');
  eq(log.stalePending, 0, 'no Board card left pending under a receivership');
  eq(errs().length, 0, 'no errors in three years');
}
// the player who takes the lever the dialog names
s = deficitCampus({ quality: 'basic', coaching: 0 });
{
  ok(intoReceivership(s), 'into receivership'); click(button('Got it'));
  let sold = 0;
  let raised = 0;
  /** do what the dialog's lines say, top line first, until the average month stops losing money: the bulldozer on the building it names, else a tuition step */
  const lever = (x) => { for (let k = 0; k < 40 && EC.budget(x).net < 0; k++) { const lines = (PR.receiverBrief(x) || { sections: [] }).sections.map((sc) => sc.lines.join(' ')).join(' '), m = /Your costliest: ([^,(]+?)(?: \(|,)/.exec(lines);
    const b = m ? B.list(x).find((y) => BSU.data.catalog[y.type].name === m[1]) : null;
    if (b && B.remove(x, b.id).ok) { sold++; continue; }
    if (/Budget: raise tuition/.test(lines) && EC.setTuition(x, x.economy.tuition + 250)) { raised++; continue; }
    break; } };
  lever(s);
  ok(sold > 0 && EC.budget(s).net >= 0, 'the levers the dialog names (the bulldozer on the building it names, then tuition steps) until the average month stops losing money (' + sold + ' sold, ' + raised + ' tuition steps, net ' + EC.budget(s).net + ')');
  const log = years(s, 3 * 120 + TERM, { each: lever });
  eq(log.entries.length, 0, 'three years on: no second receivership');
  eq(log.cards.length, 0, 'and no Board card');
  ok(fail(s).watch === false && PR.receivership(s).phase === 'none', 'no warning left');
}
// the gap the Board itself closes
s = deficitCampus({ ids: ['dorm', 'dorm', 'dining_hall', 'lecture_hall', 'lecture_hall', 'substation', 'water_tower'], quality: 'elite', coaching: 3000000, cash: -1950000 });
{
  s.economy.students = 500;
  const b0 = EC.budget(s);
  ok(b0.net < 0, 'a campus that loses money only through Elite faculty and a $3M coaching budget (net ' + b0.net + ')');
  ok(intoReceivership(s), 'into receivership');
  ok(EC.budget(s).net > 0, 'the Board\'s two cuts balance it (net ' + EC.budget(s).net + ')');
  ok(/Today the books balance: about \$\d+k a month to the good\./.test(dialog().text), 'the dialog says the books balance'); click(button('Got it'));
  const log = years(s, 3 * 120 + TERM);
  eq(log.entries.length, 0, 'left alone for three years: no second receivership');
  ok(log.exits.length === 1 && fail(s).watch === false, 'it ended once, with no warning left');
}

// --- (9) save / load, old saves, the CSS -----------------------------------------------------------------------------------------------
console.log('--- (9) save / load, old saves, CSS ---');
s = deficitCampus();
{
  ok(intoReceivership(s), 'into receivership'); click(button('Got it'));
  H.fastForwardDays(5); calm(s);
  const until = fail(s).receiverUntilDay, brief = JSON.stringify(fail(s).brief);
  SS.save('manual.0'); SS.newGame({ seed: 7, skipTutorial: true, size: 96 }); s = SS.load('manual.0'); U.showTitle(false); frame(s);
  ok(fail(s).receiver === true && fail(s).receiverUntilDay === until && JSON.stringify(fail(s).brief) === brief, 'a save in the middle loads with the receivership and its brief');
  eq(chip(), 'Receivership · ' + (until - s.calendar.day) + ' days left', 'the chip is back after the load');
  ok(/^Receivership: \d+ days left$/.test(B.canPlace(s, 'dorm', 40, 40, {}).reason), 'the freeze too');
  runUntil(s, (x) => fail(x).receiver === false, TERM + 2);
  ok(fail(s).receiver === false && s.economy.cash >= 0 && s.ui.speed === fail(s).brief.speedBefore, 'and it ends as it should (cash ' + s.economy.cash + ', speed ' + s.ui.speed + '×)');
  // a save from before the pass: the failure branch without the new keys, in the middle of the old 120-day receivership
  U.closeCard(); const f = fail(s); delete f.brief; delete f.watch; f.receiver = true; f.receiverUntilDay = s.calendar.day + 100; f.pendingKind = 'bankruptcy';
  const r = PR.receivership(s), br = PR.receiverBrief(s);
  ok(r.phase === 'receiver' && r.daysLeft === 100 && br && /^Receivership: 100 days left$/.test(br.title) && f.watch === false && f.brief === null, 'an old save in receivership: the chip and the dialog work without the new keys');
  runUntil(s, (x) => fail(x).receiver === false, 140);
  ok(fail(s).receiver === false && fail(s).pendingKind === null && s.economy.cash >= 0, 'and it ends: the Board\'s card the old build left pending for ever is cleared with it (economy can offer one again)');
  eq(errs().length, 0, 'no errors');
}
{
  const css = readFileSync(join(here, '..', '..', 'src', 'style.css'), 'utf8');
  const rules = css.split('\n').filter((l) => /#board-chip|#card-receiver|\.brief |\.obj-paused/.test(l)).join('\n');
  ok(/#board-chip\{[^}]*position:absolute[^}]*right:var\(--gutter\)[^}]*top:calc\(var\(--bar-h\) \+ 8px\)/.test(rules), 'the chip sits top-right under the app bar');
  ok(/#board-chip\[data-tone="danger"\]\{background:var\(--error-container\);color:var\(--on-error-container\)/.test(rules) && /#board-chip\{[^}]*background:var\(--surface\);color:var\(--warn-text\)/.test(rules), 'its tones are the error container and the warn text on the surface');
  ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(rules.replace(/#board-chip|#card-receiver|#hud/g, '')), 'tokens only: no literal colour in the new rules');
  ok(/#card-receiver \.card-actions\{position:sticky;bottom:0/.test(rules), 'Got it stays in view when a short window scrolls the dialog');
  ok(Buffer.byteLength(css) <= 108 * 1024, 'style.css stays under its 108 KB cap (' + (Buffer.byteLength(css) / 1024).toFixed(1) + ' KB)');
  ok(BSU.icons.has('hourglass') && BSU.icons.has('warning') && BSU.icons.has('pause'), 'the icons come from BSU.icons');
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
