import type {
  createRouter,
  ResolveParams,
  RootRoute,
  Route,
} from "@tanstack/react-router";

type EvEmpty = Record<PropertyKey, never>;

export interface PageRouteTypeDefinition {
  id: string;
  path: string;
  module: unknown;
}

export type PageRouteTypeDefinitions<TRoutes> = {
  [K in keyof TRoutes]: PageRouteTypeDefinition;
};

export type CreatePageRouteRegister<
  TRoutes extends PageRouteTypeDefinitions<TRoutes>,
> = {
  router: ReturnType<typeof createRouter<EvPageRouteTree<TRoutes>>>;
};

type EvModuleSearchValidator<TModule> = TModule extends {
  validateSearch: infer TValidator;
}
  ? TValidator
  : undefined;

type EvModuleLoader<TModule> = TModule extends { loader: infer TLoader }
  ? TLoader
  : undefined;

type EvRootRoute<TPageRouteTypes = unknown> = RootRoute<
  unknown,
  undefined,
  EvEmpty,
  EvEmpty,
  EvEmpty,
  EvEmpty,
  undefined,
  unknown,
  TPageRouteTypes,
  unknown,
  unknown,
  unknown
>;

type EvPageRoute<TId extends string, TFullPath extends string, TModule> = Route<
  unknown,
  EvRootRoute,
  TFullPath,
  TFullPath,
  TId,
  TId,
  EvModuleSearchValidator<TModule>,
  ResolveParams<TFullPath>,
  EvEmpty,
  EvEmpty,
  EvEmpty,
  EvEmpty,
  EvModuleLoader<TModule>,
  unknown,
  unknown,
  unknown,
  unknown,
  unknown
>;

type EvRouteDefinitionValue<TRoutes extends PageRouteTypeDefinitions<TRoutes>> =
  TRoutes[keyof TRoutes];

type EvRouteFromDefinition<TDefinition> = TDefinition extends {
  id: infer TId extends string;
  path: infer TPath extends string;
  module: infer TModule;
}
  ? EvPageRoute<TId, TPath, TModule>
  : never;

type EvPageRouteTypes<TRoutes extends PageRouteTypeDefinitions<TRoutes>> = {
  fullPaths: EvRouteDefinitionValue<TRoutes>["path"];
  to: EvRouteDefinitionValue<TRoutes>["path"];
  id: EvRouteDefinitionValue<TRoutes>["id"];
  fileRoutesByFullPath: {
    [K in keyof TRoutes as TRoutes[K]["path"]]: EvRouteFromDefinition<
      TRoutes[K]
    >;
  };
  fileRoutesByTo: {
    [K in keyof TRoutes as TRoutes[K]["path"]]: EvRouteFromDefinition<
      TRoutes[K]
    >;
  };
  fileRoutesById: {
    [K in keyof TRoutes as TRoutes[K]["id"]]: EvRouteFromDefinition<TRoutes[K]>;
  };
};

type EvPageRouteTree<TRoutes extends PageRouteTypeDefinitions<TRoutes>> =
  EvRootRoute<EvPageRouteTypes<TRoutes>>;
