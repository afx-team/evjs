import type {
  GeneratedModuleDeclaration,
  GeneratedModuleDeclarationExport,
  GeneratedModuleRef,
  ResolveAliasContribution,
} from "../src/plugin/index.js";

interface ExtendedResolveAliasContribution extends ResolveAliasContribution {
  readonly owner: string;
}

interface ExtendedDeclarationExport extends GeneratedModuleDeclarationExport {
  readonly owner: string;
}

declare const replacement: GeneratedModuleRef | string;

const contributionWithUnionReplacement: ResolveAliasContribution = {
  id: "database",
  specifier: "evdb:database",
  replacement,
  declaration: {
    exports: [{ kind: "value", name: "database" }],
  },
};

const extendedContribution: ExtendedResolveAliasContribution = {
  ...contributionWithUnionReplacement,
  owner: "database-plugin",
};

const renamedDeclaration: GeneratedModuleDeclaration = {
  exports: [
    {
      kind: "value",
      name: "database",
      // @ts-expect-error declaration export renaming is intentionally unsupported
      as: "renamedDatabase",
    },
  ],
};

const missingNonGenericAudit: GeneratedModuleDeclaration = {
  exports: [
    // @ts-expect-error type exports require an explicit non-generic audit
    {
      kind: "type",
      name: "Database",
    },
  ],
};

const unsupportedGenericMetadata: GeneratedModuleDeclaration = {
  exports: [
    {
      kind: "type",
      name: "Box",
      // @ts-expect-error generic type declaration metadata is not supported
      typeParameters: ["T"],
    },
  ],
};

export type ResolveAliasContributionTypeAssertions =
  | typeof contributionWithUnionReplacement
  | typeof extendedContribution
  | typeof renamedDeclaration
  | typeof missingNonGenericAudit
  | typeof unsupportedGenericMetadata
  | ExtendedDeclarationExport;
