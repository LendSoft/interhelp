console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions && process.versions.electron);
console.log('process.versions.node:', process.versions && process.versions.node);
const e = require('electron');
console.log('typeof electron:', typeof e);
process.exit(0);
