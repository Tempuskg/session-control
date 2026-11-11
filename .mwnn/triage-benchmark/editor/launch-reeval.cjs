'use strict';
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');
exports.run = async () => {
  try {
    const resultPath = await vscode.commands.executeCommand('mwnn.runAdjustedTriageReeval');
    fs.writeFileSync(
      path.join(__dirname, '../editor-launch-result.json'),
      JSON.stringify({ state: 'complete', mode: 'reeval-v2', resultPath }, null, 2),
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(__dirname, '../editor-launch-result.json'),
      JSON.stringify({ state: 'failed', mode: 'reeval-v2', name: error?.name || 'Error' }, null, 2),
    );
    throw error;
  }
};
