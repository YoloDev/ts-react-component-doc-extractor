import Parser from './parser';

if (require.main === module) {
  // tslint:disable:no-console
  console.log(
    Parser.parse(
      '/Users/alxandr/spt/ui-components/src/atoms/Button/Button.tsx',
    ),
  );
  // tslint:enable:no-console
}

export default Parser;
