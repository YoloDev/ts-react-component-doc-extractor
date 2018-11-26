import Parser from './parser';

if (require.main === module) {
  // tslint:disable:no-console
  const docgen = Parser.fromConfig(
    '/Users/alxandr/spt/ui-components/tsconfig.json',
  );

  const propsWhiteList = new Set(['children', 'className']);

  const hasReactParent = (decl: any): boolean => {
    if (!decl.parent) {
      return false;
    }
    if (decl.parent.name && decl.parent.name.text === 'React') {
      return true;
    }
    return hasReactParent(decl.parent);
  };

  const fullName = (sym: any): string =>
    sym.parent ? fullName(sym.parent) + '.' + sym.name : sym.name;

  const isReactType = (sym: any): boolean => {
    // we have a white-list of props that we always display
    if (propsWhiteList.has(sym.name)) {
      return false;
    }

    const symbolFullName = fullName(sym);
    if (symbolFullName.startsWith('React')) {
      return true;
    }

    if (!sym.declarations) {
      return false;
    }
    const [decl] = sym.declarations;

    if (hasReactParent(decl)) {
      return true;
    }
    return false;
  };

  docgen.propertyFilter = sym => !isReactType(sym);

  console.time('Button');
  console.log(
    docgen.parse(
      '/Users/alxandr/spt/ui-components/src/atoms/Button/Button.tsx',
    ),
  );
  console.timeEnd('Button');

  console.time('Box');
  console.log(
    docgen.parse('/Users/alxandr/spt/ui-components/src/atoms/Box/Box.tsx'),
  );
  console.timeEnd('Box');
  // tslint:enable:no-console
}

export default Parser;
