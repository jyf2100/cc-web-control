#!/usr/bin/env node
'use strict';
const { run } = require('../hub/mcp/stdio.cjs');
run().catch((e) => { console.error(String((e && e.stack) || e)); process.exit(1); });
