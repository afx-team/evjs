module.exports = function rscClientReferenceLoader(source, inputMap) {
  this.cacheable?.();

  const callback = this.async();
  import("@evjs/ev/_internal/build")
    .then(({ transformRscClientFile }) =>
      transformRscClientFile(source, {
        resourcePath: this.resourcePath,
        rootContext: this.rootContext,
      }),
    )
    .then((result) => {
      callback(null, result.code, result.map ?? inputMap);
    })
    .catch((error) => {
      callback(error);
    });
};
