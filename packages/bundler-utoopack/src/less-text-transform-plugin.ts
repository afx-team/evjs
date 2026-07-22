interface TextTransformOptions {
  prependText?: string;
  appendText?: string;
  include?: string | RegExp | (string | RegExp)[];
  exclude?: string | RegExp | (string | RegExp)[];
}

interface LessProcessorExtra {
  fileInfo: { filename: string };
}

interface LessPluginManager {
  addPreProcessor(
    processor: { process(src: string, extra: LessProcessorExtra): string },
    priority: number,
  ): void;
}

const isRegExp = (value: unknown): value is RegExp => value instanceof RegExp;

const validateMatchRule = (rule: string | RegExp, filePath: string): boolean =>
  isRegExp(rule) ? rule.test(filePath) : filePath.includes(rule);

const isMatched = (
  rules: string | RegExp | (string | RegExp)[],
  filePath: string,
): boolean => {
  const arr = Array.isArray(rules) ? rules : [rules];
  return arr.filter(Boolean).some((rule) => validateMatchRule(rule, filePath));
};

class PrependProcessor {
  constructor(private options: TextTransformOptions) {}

  process(src: string, extra: LessProcessorExtra): string {
    const filename = extra.fileInfo.filename;
    if (
      (this.options.include && !isMatched(this.options.include, filename)) ||
      (this.options.exclude && isMatched(this.options.exclude, filename))
    ) {
      return src;
    }
    return `${this.options.prependText ?? ""}${src}${this.options.appendText ?? ""}`;
  }
}

class TextTransform {
  constructor(private options: TextTransformOptions) {}

  install(_less: unknown, pluginManager: LessPluginManager): void {
    pluginManager.addPreProcessor(new PrependProcessor(this.options), 2000);
  }
}

export { TextTransform, type TextTransformOptions };
