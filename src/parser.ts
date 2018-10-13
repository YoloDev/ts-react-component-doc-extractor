import {
  ParentType,
  PropItem,
  Props,
  PropertyFilter as SimplePropertyFilter,
  StringIndexedObject,
} from './types';

import findUp from 'find-up';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

type PropertyFilter = (
  symbol: ts.Symbol,
  type: ts.Type,
  component: ts.Symbol,
) => boolean;

interface JSDoc {
  description: string;
  fullComment: string;
  tags: StringIndexedObject<string>;
}

const defaultJSDoc: JSDoc = {
  description: '',
  fullComment: '',
  tags: {},
};

const formatTag = (tag: ts.JSDocTagInfo) => {
  let result = '@' + tag.name;
  if (tag.text) {
    result += ' ' + tag.text;
  }

  return result;
};

const nullFilter: PropertyFilter = () => true;
const simpleNullFilter: SimplePropertyFilter = () => true;

const pathDepth = (fileName: string, depth = 0): number => {
  const parent = path.dirname(fileName);
  return parent && parent !== fileName ? pathDepth(parent) + depth : depth;
};

const mostRoot = (files: ReadonlyArray<string>) => {
  let file = files[0];
  let depth = pathDepth(file);
  for (const f of files) {
    const fDepth = pathDepth(f);
    if (fDepth < depth) {
      depth = fDepth;
      file = f;
    }
  }

  return file;
};

const hasFlag = <T extends number>(flags: T, value: T) =>
  Boolean(flags & value);

const propsType = ts.createTypeAliasDeclaration(
  void 0,
  void 0,
  'ReactProps',
  [ts.createTypeParameterDeclaration('C')],
  ts.createConditionalTypeNode(
    ts.createTypeReferenceNode('C', void 0),
    ts.createTypeReferenceNode(
      ts.createQualifiedName(ts.createIdentifier('React'), 'ComponentType'),
      [ts.createInferTypeNode(ts.createTypeParameterDeclaration('P'))],
    ),
    ts.createTypeReferenceNode(
      ts.createQualifiedName(
        ts.createIdentifier('JSX'),
        'LibraryManagedAttributes',
      ),
      [
        ts.createTypeReferenceNode('C', void 0),
        ts.createTypeReferenceNode('P', void 0),
      ],
    ),
    //ts.createTypeReferenceNode('P', void 0),
    ts.createTypeReferenceNode('never', void 0),
  ),
);

const fakeName = (() => {
  let count = 0;
  return () => `/fakefs/ts/export-${count++}.d.ts`;
})();

const removeExtension = (fileName: string) => {
  const dot = fileName.lastIndexOf('.');
  return fileName.substr(0, dot);
};

interface ModifiableCompilerHost extends ts.CompilerHost {
  addSourceFile(fileName: string, source: string): void;
  removeSourceFile(fileName: string): void;
}

const createCompilerHost = (
  options: ts.CompilerOptions,
): ModifiableCompilerHost => {
  const extraFiles = new Map<string, string>();
  const host = ts.createCompilerHost(options);
  const fn = (value: any) => ({ value });
  return Object.create(host, {
    getSourceFile: fn(function getSourceFile(
      fileName: string,
      languageVersion: ts.ScriptTarget,
      onError?: ((message: string) => void) | undefined,
      shouldCreateNewSourceFile?: boolean | undefined,
    ): ts.SourceFile | void {
      const extraFile = extraFiles.get(fileName);
      if (extraFile) {
        return ts.createSourceFile(fileName, extraFile, languageVersion);
      }

      return host.getSourceFile(
        fileName,
        languageVersion,
        onError,
        shouldCreateNewSourceFile,
      );
    }),

    addSourceFile: fn(function addSourceFile(fileName: string, source: string) {
      if (extraFiles.has(fileName)) {
        throw new Error(`File ${fileName} already exists`);
      }

      extraFiles.set(fileName, source);
    }),

    removeSourceFile: fn(function removeSourceFile(fileName: string) {
      extraFiles.delete(fileName);
    }),
  });
};

const makePropsExportFile = (
  exp: ts.Symbol,
  file: ts.SourceFile,
  rootPath: string,
  printer: ts.Printer,
): { readonly source: string; readonly fileName: string } => {
  // TODO: Support generic symbols
  const importReact = ts.createImportDeclaration(
    void 0,
    void 0,
    ts.createImportClause(ts.createIdentifier('React'), void 0),
    ts.createStringLiteral('react'),
  );

  const importStmt = ts.createImportDeclaration(
    void 0,
    void 0,
    ts.createImportClause(
      void 0,
      ts.createNamedImports([
        ts.createImportSpecifier(
          ts.createIdentifier(exp.name),
          ts.createIdentifier('Component'),
        ),
      ]),
    ),
    ts.createStringLiteral(removeExtension(file.fileName)),
  );

  const exportStmt = ts.createTypeAliasDeclaration(
    void 0,
    [ts.createModifier(ts.SyntaxKind.ExportKeyword)],
    'Props',
    void 0,
    ts.createTypeReferenceNode('ReactProps', [
      ts.createTypeQueryNode(ts.createIdentifier('Component')),
    ]),
  );

  let output = ts.createSourceFile(
    rootPath + fakeName(),
    '',
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );

  output = ts.updateSourceFileNode(
    output,
    [importReact, importStmt, propsType, exportStmt],
    true,
  );

  return { source: printer.printFile(output), fileName: output.fileName };
};

export function getDefaultExportForFile(source: ts.SourceFile) {
  const name = path.basename(source.fileName, path.extname(source.fileName));

  return name === 'index' ? path.basename(path.dirname(source.fileName)) : name;
}

function computeComponentName(exp: ts.Symbol, source: ts.SourceFile) {
  const exportName = exp.getName();

  const statelessDisplayName = getTextValueOfFunctionProperty(
    exp,
    source,
    'displayName',
  );

  const statefulDisplayName =
    exp.valueDeclaration &&
    ts.isClassDeclaration(exp.valueDeclaration) &&
    getTextValueOfClassMember(exp.valueDeclaration, 'displayName');

  if (statelessDisplayName || statefulDisplayName) {
    return statelessDisplayName || statefulDisplayName || '';
  }

  if (
    exportName === 'default' ||
    exportName === '__function' ||
    exportName === 'StatelessComponent'
  ) {
    return getDefaultExportForFile(source);
  } else {
    return exportName;
  }
}

function isInterfaceOrTypeAliasDeclaration(
  node: ts.Node,
): node is ts.InterfaceDeclaration | ts.TypeAliasDeclaration {
  return (
    node.kind === ts.SyntaxKind.InterfaceDeclaration ||
    node.kind === ts.SyntaxKind.TypeAliasDeclaration
  );
}

function getTextValueOfClassMember(
  classDeclaration: ts.ClassDeclaration,
  memberName: string,
): string {
  const [textValue] = classDeclaration.members
    .filter(member => ts.isPropertyDeclaration(member))
    .filter(member => {
      const name = ts.getNameOfDeclaration(member) as ts.Identifier;
      return name && name.text === memberName;
    })
    .map(member => {
      const property = member as ts.PropertyDeclaration;
      return (
        property.initializer && (property.initializer as ts.Identifier).text
      );
    });

  return textValue || '';
}

function getTextValueOfFunctionProperty(
  exp: ts.Symbol,
  source: ts.SourceFile,
  propertyName: string,
) {
  const [textValue] = source.statements
    .filter(statement => ts.isExpressionStatement(statement))
    .filter(statement => {
      const expr = (statement as ts.ExpressionStatement)
        .expression as ts.BinaryExpression;
      return (
        expr.left &&
        (expr.left as ts.PropertyAccessExpression).name.escapedText ===
          propertyName
      );
    })
    .filter(statement => {
      const expr = (statement as ts.ExpressionStatement)
        .expression as ts.BinaryExpression;

      return (
        ((expr.left as ts.PropertyAccessExpression).expression as ts.Identifier)
          .escapedText === exp.getName()
      );
    })
    .filter(statement => {
      return ts.isStringLiteral(
        ((statement as ts.ExpressionStatement)
          .expression as ts.BinaryExpression).right,
      );
    })
    .map(statement => {
      return (((statement as ts.ExpressionStatement)
        .expression as ts.BinaryExpression).right as ts.Identifier).text;
    });

  return textValue || '';
}

function getParentType(prop: ts.Symbol): ParentType | undefined {
  const declarations = prop.getDeclarations();

  if (declarations == null || declarations.length === 0) {
    return undefined;
  }

  // Props can be declared only in one place
  const { parent } = declarations[0];

  if (!isInterfaceOrTypeAliasDeclaration(parent)) {
    return undefined;
  }

  const parentName = parent.name.text;
  const { fileName } = parent.getSourceFile();

  // const fileNameParts = fileName.split(path.sep);
  // const trimmedFileNameParts = fileNameParts.slice();

  // while (trimmedFileNameParts.length) {
  //   if (trimmedFileNameParts[0] === currentDirectoryName) {
  //     break;
  //   }
  //   trimmedFileNameParts.splice(0, 1);
  // }
  // let trimmedFileName;
  // if (trimmedFileNameParts.length) {
  //   trimmedFileName = trimmedFileNameParts.join(path.sep);
  // } else {
  //   trimmedFileName = fileName;
  // }

  return {
    fileName: fileName,
    name: parentName,
  };
}

class Parser {
  static fromConfig(tsconfigPath: string) {
    const basePath = path.dirname(tsconfigPath);
    const { config, error } = ts.readConfigFile(tsconfigPath, filename =>
      fs.readFileSync(filename, 'utf8'),
    );

    if (typeof error !== 'undefined') {
      throw error;
    }

    const { options, errors } = ts.parseJsonConfigFileContent(
      config,
      ts.sys,
      basePath,
      {},
      tsconfigPath,
    );

    if (errors && errors.length) {
      throw errors[0];
    }

    return new Parser(options);
  }

  static parse(filePathOrPaths: string | ReadonlyArray<string>) {
    const files: ReadonlyArray<string> = Array.isArray(filePathOrPaths)
      ? filePathOrPaths
      : [filePathOrPaths];
    const tsconfigPath = findUp.sync('tsconfig.json', {
      cwd: path.dirname(mostRoot(files)),
    });

    let parser: Parser;
    if (tsconfigPath) {
      parser = Parser.fromConfig(tsconfigPath);
    } else {
      parser = new Parser({
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.Latest,
      });
    }

    return parser.parse(files);
  }

  private readonly host: ModifiableCompilerHost;
  private readonly options: ts.CompilerOptions;
  private readonly printer: ts.Printer;
  private readonly rootPath: string;
  private readonly propertyFilter: PropertyFilter;
  private readonly simplePropFilter: SimplePropertyFilter;
  private program: ts.Program | undefined = void 0;
  constructor(
    options: ts.CompilerOptions,
    propertyFilter: PropertyFilter = nullFilter,
    simplePropFilter: SimplePropertyFilter = simpleNullFilter,
  ) {
    this.options = {
      ...options,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.Latest,
    };
    this.rootPath = options.rootDir || path.resolve('.');
    this.host = createCompilerHost(options);
    this.printer = ts.createPrinter();
    this.propertyFilter = propertyFilter;
    this.simplePropFilter = simplePropFilter;
  }

  parse(filePathOrPaths: string | ReadonlyArray<string>) {
    const filePaths: ReadonlyArray<string> = Array.isArray(filePathOrPaths)
      ? filePathOrPaths
      : [filePathOrPaths];

    const program = (this.program = ts.createProgram(
      [...filePaths],
      this.options,
      this.host,
      this.program,
    ));

    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) {
      const msg = ts.formatDiagnostics(diagnostics, this.host);
      throw new Error(`Compile failed:\n${msg}`);
    }

    const checker = program.getTypeChecker();
    //const extractType = getExtractType(program, checker, this.extractorPath);

    return ([] as any[]).concat(
      ...filePaths
        .map(filePath => program.getSourceFile(filePath))
        .filter((sourceFile): sourceFile is ts.SourceFile => sourceFile != null)
        .map(sourceFile => {
          const moduleSymbol = checker.getSymbolAtLocation(sourceFile);

          if (!moduleSymbol) {
            return [];
          }

          return checker
            .getExportsOfModule(moduleSymbol)
            .map(exp => this.getComponentInfo(exp, sourceFile, program))
            .filter(r => r != null);
        }),
    );
  }

  getComponentInfo(
    exp: ts.Symbol,
    sourceFile: ts.SourceFile,
    program: ts.Program,
  ) {
    const exportPropsFile = makePropsExportFile(
      exp,
      sourceFile,
      this.rootPath,
      this.printer,
    );
    try {
      this.host.addSourceFile(exportPropsFile.fileName, exportPropsFile.source);
      const subProgram = ts.createProgram(
        [exportPropsFile.fileName],
        this.options,
        this.host,
        program,
      );

      const diagnostics = ts.getPreEmitDiagnostics(subProgram);
      if (diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) {
        // const msg = ts.formatDiagnostics(diagnostics, this.host);
        // console.log(exportPropsFile.source);
        // throw new Error(`Compile failed:\n${msg}`);
        return null;
      }

      const checker = subProgram.getTypeChecker();
      const exportSourceFile = subProgram.getSourceFile(
        exportPropsFile.fileName,
      );
      if (!exportSourceFile) return null;
      const moduleSymbol = checker.getSymbolAtLocation(exportSourceFile);
      if (!moduleSymbol) return null;

      const propsExport = checker
        .getExportsOfModule(moduleSymbol)
        .find(s => s.name === 'Props');

      if (!propsExport) return null;
      const componentName = computeComponentName(exp, sourceFile);
      const comp = Object.freeze({
        name: componentName,
      });
      const type = checker.getDeclaredTypeOfSymbol(propsExport);
      const propsArray = type
        .getProperties()
        .map(s => {
          const symbolType = checker.getTypeOfSymbolAtLocation(
            s,
            s.valueDeclaration || s.declarations[0],
          );
          return {
            symbol: s,
            type: symbolType,
          };
        })
        .filter(({ symbol, type }) => this.propertyFilter(symbol, type, exp))
        .map(prop => this.getPropInfo(checker, prop.symbol, prop.type))
        .filter(prop => this.simplePropFilter(prop, comp));

      const props: Props = {};
      for (const prop of propsArray) {
        (props as any)[prop.name] = prop;
      }

      let commentSource = exp;
      if (!exp.valueDeclaration) {
        if (hasFlag(exp.getFlags(), ts.SymbolFlags.Alias)) {
          commentSource = checker.getAliasedSymbol(commentSource);
        }
      }

      return {
        description: this.findDocComment(checker, commentSource).fullComment,
        displayName: componentName,
        props,
      };
    } finally {
      this.host.removeSourceFile(exportPropsFile.fileName);
    }
    // const typeExportFile = ts.createSourceFile(
    //   fakeName(),
    //   make
    // )
    //const subProgram = ts.createProgram()
    // if (!!exp.declarations && exp.declarations.length === 0) {
    //   return null;
    // }

    // const isTypeAlias = hasFlag(exp.flags, ts.SymbolFlags.TypeAlias);
    // const isAlias = hasFlag(exp.flags, ts.SymbolFlags.Alias);
    // const isFunction = hasFlag(exp.flags, ts.SymbolFlags.Function);
    // const isClass = hasFlag(exp.flags, ts.SymbolFlags.Class);
    // return {
    //   name: checker.getFullyQualifiedName(exp),
    //   isTypeAlias,
    //   isAlias,
    //   isFunction,
    //   isClass,
    // };
    // const type = checker.getTypeOfSymbolAtLocation(
    //   exp,
    //   exp.valueDeclaration || exp.declarations![0],
    // );

    // const symbol = type.symbol;
    // const aliasSymbol = type.aliasSymbol;
    // if (!symbol && !aliasSymbol) return null;

    // const propsTypeSymbol = this.getPropsTypeSymbol(
    //   symbol || aliasSymbol,
    //   checker,
    //   program,
    // );
    // return propsTypeSymbol;

    // const sfqn = symbol && checker.getFullyQualifiedName(symbol);
    // const afqn = aliasSymbol && checker.getFullyQualifiedName(aliasSymbol);
    // return {
    //   symbol,
    //   aliasSymbol,
    //   sfqn,
    //   afqn,
    //   name: symbol && symbol.getName(),
    // };
  }

  getPropInfo(
    checker: ts.TypeChecker,
    symbol: ts.Symbol,
    type: ts.Type,
  ): PropItem {
    const name = symbol.getName();
    const typeString = checker.typeToString(type.getNonNullableType());
    const isOptional = hasFlag(symbol.getFlags(), ts.SymbolFlags.Optional);
    const jsDocComment = this.findDocComment(checker, symbol);
    const defaultValue = jsDocComment.tags.default
      ? { value: jsDocComment.tags.default }
      : null;
    const parent = getParentType(symbol);

    return {
      name,
      required: !isOptional,
      type: { name: typeString },
      description: jsDocComment.fullComment,
      defaultValue,
      parent,
    };
  }

  findDocComment(checker: ts.TypeChecker, symbol: ts.Symbol): JSDoc {
    const comment = this.getFullJsDocComment(checker, symbol);
    if (comment.fullComment) {
      return comment;
    }

    const rootSymbols = checker.getRootSymbols(symbol);
    const commentsOnRootSymbols = rootSymbols
      .filter(x => x !== symbol)
      .map(x => this.getFullJsDocComment(checker, x))
      .filter(x => !!x.fullComment);

    if (commentsOnRootSymbols.length) {
      return commentsOnRootSymbols[0];
    }

    return defaultJSDoc;
  }

  getFullJsDocComment(checker: ts.TypeChecker, symbol: ts.Symbol): JSDoc {
    // in some cases this can be undefined (Pick<Type, 'prop1'|'prop2'>)
    if (!symbol.getDocumentationComment) {
      return defaultJSDoc;
    }

    let mainComment = ts.displayPartsToString(
      symbol.getDocumentationComment(checker),
    );

    if (mainComment) {
      mainComment = mainComment.replace('\r\n', '\n');
    }

    const tags = symbol.getJsDocTags() || [];
    const tagComments: string[] = [];
    const tagMap: StringIndexedObject<string> = {};
    tags.forEach(tag => {
      const trimmedText = (tag.text || '').trim();
      const currentValue = tagMap[tag.name];
      (tagMap as any)[tag.name] = currentValue
        ? currentValue + '\n' + trimmedText
        : trimmedText;

      if (tag.name !== 'default') {
        tagComments.push(formatTag(tag));
      }
    });

    return {
      description: mainComment,
      fullComment: (mainComment + '\n' + tagComments.join('\n')).trim(),
      tags: tagMap,
    };
  }
}

export default Parser;
