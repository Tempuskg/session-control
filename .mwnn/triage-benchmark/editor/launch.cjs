'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
exports.run = async () => {
  try {
    const resultPath = await vscode.commands.executeCommand('mwnn.runApprovedTriageBenchmark');
    fs.writeFileSync(path.join(__dirname, '../editor-launch-result.json'), JSON.stringify({ state: 'complete', resultPath }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(__dirname, '../editor-launch-result.json'), JSON.stringify({ state: 'failed', name: error?.name || 'Error' }, null, 2));
    throw error;
  }
};
