module.exports = function serverFunctionLoader(source, inputMap) {
  this.cacheable?.();

  const callback = this.async();
  const options = this.getOptions();

  import("@evjs/ev/_internal/build")
    .then(({ transformServerFile }) =>
      transformServerFile(source, {
        resourcePath: this.resourcePath,
        rootContext: options.rootContext,
        isServer: Boolean(options.isServer),
      }),
    )
    .then((result) => {
      callback(null, result.code, result.map ?? inputMap);
    })
    .catch((error) => {
      callback(error);
    });
};
