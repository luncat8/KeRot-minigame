// The standing of every bot type across games: the share of a finished game's whole
// points the type earned, kept in localStorage as an exponential moving average.
// "retriever: 0.6" reads "the retriever takes 60 % of the points in a typical game",
// so one lucky or one ruined game nudges the number instead of rewriting it.
// Node-safe: with no storage the record is simply empty (and never written).
if (typeof module !== 'undefined') module.exports = { BotRecord };

const BotRecord = (() => {
	const KEY = 'kerot.botShare';
	const ALPHA = 0.25; // one game moves a standing a quarter of the way to its share
	function read() {
		try {
			const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
			const map = raw ? JSON.parse(raw) : {};
			return map && typeof map === 'object' ? map : {};
		} catch (e) { return {}; } // storage refused (private mode, file:// policy): the card still shows the line
	}
	function write(map) {
		try {
			if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(map));
		} catch (e) { /* nothing to do: the standing simply does not outlive the page */ }
	}
	// One finished game. A type's share is the sum over its seats, so a table that
	// seats the same profile twice moves that one standing by both seats' points.
	function update(roster) {
		const map = read(), won = {};
		let total = 0, bots = 0;
		for (let i = 0; i < roster.length; i++) {
			const seat = roster[i];
			total += seat.score;
			if (seat.type === 'human') continue;
			won[seat.type] = (won[seat.type] || 0) + seat.score;
			bots++;
		}
		if (!(total > 0) || !bots) return map; // a game nothing earned, or no bot at all, leaves the standings alone
		for (const type in won) {
			const share = won[type] / total;
			map[type] = map[type] === undefined ? share : (1 - ALPHA) * map[type] + ALPHA * share;
		}
		for (const type in map) map[type] = Math.round(map[type] * 1e4) / 1e4; // the card shows two decimals, four survive
		write(map);
		return map;
	}
	// The result card's line: the types that just played, best standing first.
	function line(roster) {
		const map = read(), seen = {}, list = [];
		for (let i = 0; i < roster.length; i++) {
			const type = roster[i].type;
			if (type === 'human' || seen[type] || map[type] === undefined) continue;
			seen[type] = 1;
			list.push([map[type], type]);
		}
		if (!list.length) return '';
		list.sort((a, b) => b[0] - a[0]);
		let out = '';
		for (let i = 0; i < list.length; i++) out += (i ? ' · ' : '') + list[i][1] + ' ' + list[i][0].toFixed(2);
		return 'bot record · ' + out;
	}
	return { update, line };
})();
