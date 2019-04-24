var fs = require('fs');
var resolve = require('path').resolve;
var join = require('path').join;
var cp = require('child_process');

// get library path
var lib = resolve(__dirname, '../plugins/');
 
fs.readdirSync(lib).forEach(function (mod) {
	var modPath = join(lib, mod);
	// ensure path has package.json
	if (!fs.existsSync(join(modPath, 'package.json'))) return;
	// install folder
	var command = /^win/.test(process.platform) ? 'npm.cmd' : 'npm';
	cp.spawn(command, ['install'], { env: process.env, cwd: modPath, stdio: 'inherit' });
});