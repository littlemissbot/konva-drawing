// CommonJS (not .js) because package.json sets "type": "module": Jest's
// babel-jest config loader expects to require() this synchronously.
module.exports = {
  presets: [["@babel/preset-env", { targets: { node: "current" } }]],
};
