'use strict';
const path = require('node:path');
const webpack = require('webpack');
const root = path.resolve(__dirname, '../..');
webpack({
  context: root, target: 'node', mode: 'none',
  entry: path.join(__dirname, 'library.cjs'),
  output: { path: __dirname, filename: 'library.bundle.cjs', library: { type: 'commonjs2' } },
  resolve: { extensions: ['.ts', '.js', '.cjs'], alias: { vscode: path.join(__dirname, 'vscode-shim.cjs') } },
  module: { rules: [{ test: /\.ts$/, exclude: /node_modules/, use: { loader: 'ts-loader', options: { transpileOnly: true } } }] },
}, (error, stats) => {
  if (error || stats.hasErrors()) {
    console.error(error ? error.message : stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
  } else { console.log('Built workspace-local benchmark library from current source.'); }
});
