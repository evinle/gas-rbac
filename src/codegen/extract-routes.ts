import ts from 'typescript';

export function extractRoutes_(sourceText: string): string[] {
  const source = ts.createSourceFile('entry.ts', sourceText, ts.ScriptTarget.Latest, true);
  const routes: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'anyone' || node.expression.name.text === 'requires') &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]!)
    ) {
      routes.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return routes;
}
