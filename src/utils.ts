import {ArgumentNode, DirectiveNode, valueFromASTUntyped} from 'graphql'

export function getArgValueFromDirective(directive: DirectiveNode, argName: string, defaultValue?: any): any {
  if (!directive.arguments) {
    return defaultValue
  }

  const argValue = directive.arguments.find((arg: ArgumentNode) => arg.name.value === argName)

  return argValue ? valueFromASTUntyped(argValue.value) : defaultValue
}

export function findDirective<Node extends {directives?: readonly DirectiveNode[]}>(
  node: Node,
  directiveName: string
): DirectiveNode | undefined {
  if (!node.directives) {
    return undefined
  }

  return node.directives.find((directive) => directive.name.value === directiveName)
}

export function removeUndefinedValue<T extends Record<string, any>>(object: T): T {
  const newObject = {} as T

  for (const prop in object) {
    const value = object[prop]
    if (value === undefined) {
      continue
    }
    newObject[prop] = value
  }

  return newObject
}

export function isEmpty(object: Record<string, any> | any[]): boolean {
  return !(Array.isArray(object) ? object.length : Object.keys(object).length)
}
