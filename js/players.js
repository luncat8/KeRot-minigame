// Seats: the roster of a game. A seat is one player — human or bot — with his own
// balls and his own score. The roster is edited while a game is running (see
// js/game.js addPlayer / removePlayer), so going from 1 to 8 seats is a click and
// not a restart. Node-safe: no DOM access.
if (typeof module !== 'undefined') Object.assign(globalThis, require('./cfg.js'));

const SEAT_TYPES = ['human', 'random', 'keeper', 'hunter'];
const SEAT_LABELS = { human: 'human', random: 'bot — random', keeper: 'bot — keeper', hunter: 'bot — hunter' };
// One colour per seat, shared by the board HUD, the panel and the puck rings, so a
// puck on the board always reads as its owner's.
const SEAT_COLORS = ['#e74c3c', '#f39c12', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c', '#fd79a8', '#74b9ff'];
const SEAT_NAMES = ['red', 'amber', 'green', 'violet', 'orange', 'teal', 'pink', 'blue'];

function makeSeat(type, balls) { return { type: type, balls: balls, score: 0 }; }
function createRoster(types, balls) {
	const out = [];
	for (let i = 0; i < types.length; i++) out.push(makeSeat(types[i], balls));
	return out;
}
// The next seat with a ball left, starting at `from` and wrapping; −1 when the game
// is over. Seats that ran out (or that could not get a puck onto a full board) are
// simply skipped: the turn passes to whoever can still throw.
function nextSeat(roster, from) {
	for (let k = 0; k < roster.length; k++) {
		const i = (from + k) % roster.length;
		if (roster[i].balls > 0) return i;
	}
	return -1;
}
function seatsHaveBalls(roster) {
	for (let i = 0; i < roster.length; i++) if (roster[i].balls > 0) return true;
	return false;
}
function seatColor(i) { return SEAT_COLORS[i % SEAT_COLORS.length]; }
function seatName(i) { return 'P' + (i + 1) + ' ' + SEAT_NAMES[i % SEAT_NAMES.length]; }
// Highest score; −1 on an empty roster. Ties go to the seat that threw first.
function leader(roster) {
	let best = -1;
	for (let i = 0; i < roster.length; i++) if (best < 0 || roster[i].score > roster[best].score) best = i;
	return best;
}

if (typeof module !== 'undefined') module.exports = { SEAT_TYPES, SEAT_LABELS, SEAT_COLORS, SEAT_NAMES, makeSeat, createRoster, nextSeat, seatsHaveBalls, seatColor, seatName, leader };
