const { CFG, holdRadius, autoOmega } = require('../js/cfg.js');
let fail = 0;
for (const muS of [0.01, 0.045, 0.1, 0.3]) for (const om of [0.2, 0.7831, 1.5]) {
	const c = Object.assign({}, CFG, { muS: muS, omega: om });
	const expect = muS * c.g / (om * om);
	if (Math.abs(holdRadius(c) - expect) > 1e-12) { console.log('FAIL identity', muS, om); fail = 1; }
}
const ratio = holdRadius(CFG) / CFG.diskR;
console.log('default omega=' + CFG.omega.toFixed(4) + ' autoOmega=' + autoOmega(CFG).toFixed(4) + ' d_hold/R=' + ratio.toFixed(5));
if (Math.abs(ratio - 0.9) > 0.001) { console.log('FAIL 90% rule'); fail = 1; }
console.log(fail ? 'FAIL' : 'OK');
process.exit(fail);
