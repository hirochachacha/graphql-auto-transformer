import {
  valueFromASTUntyped,
  ObjectTypeDefinitionNode,
  DirectiveNode,
  ArgumentNode,
  InterfaceTypeDefinitionNode,
  FieldDefinitionNode,
  Kind,
} from 'graphql'
import {
  Transformer,
  TransformerContext,
  InvalidDirectiveError,
  TransformerContractError,
  gql,
} from 'graphql-transformer-core'
import {
  ResolverResourceIDs,
  ModelResourceIDs,
  isNonNullType,
  makeInputValueDefinition,
  unwrapNonNull,
} from 'graphql-transformer-common'
import {printBlock, compoundExpression, qref} from 'graphql-mapping-template'

export class AutoTransformer extends Transformer {
  constructor() {
    super(
      'AutoTransformer',
      gql`
        directive @auto(creatable: Boolean = false, updatable: Boolean = false) on FIELD_DEFINITION
      `
    )
  }

  public field = (
    parent: ObjectTypeDefinitionNode | InterfaceTypeDefinitionNode,
    definition: FieldDefinitionNode,
    directive: DirectiveNode,
    ctx: TransformerContext
  ) => {
    if (parent.kind === Kind.INTERFACE_TYPE_DEFINITION) {
      throw new InvalidDirectiveError(
        `The @auto directive cannot be placed on an interface's field. See ${parent.name.value}${definition.name.value}`
      )
    }

    const modelDirective = parent.directives?.find((dir) => dir.name.value === 'model')
    if (!modelDirective) {
      throw new InvalidDirectiveError('Types annotated with @auto must also be annotated with @model.')
    }

    if (!isNonNullType(definition.type)) {
      throw new TransformerContractError(`@auto directive can only be used on non-nullable type fields`)
    }

    const isArg = (s: string) => (arg: ArgumentNode) => arg.name.value === s
    const getArg = (directive: DirectiveNode, arg: string, dflt?: any): any => {
      const argument = directive.arguments?.find(isArg(arg))
      return argument ? valueFromASTUntyped(argument.value) : dflt
    }

    const typeName = parent.name.value

    const creatable = getArg(directive, 'creatable', false)
    const updatable = getArg(directive, 'updatable', false)

    this.updateCreateInput(ctx, typeName, definition, creatable)
    this.updateUpdateInput(ctx, typeName, definition, updatable)

    // @key directive generates VTL code before @model does.
    // There're three cases @key trie to use automatic variables before they're defined.
    // 1. An automatic generated variable is a part of composite primary key:
    //   @key(fields: ["hash", "createdAt"]
    // 2. An automatic generated variable is a part of range key:
    //   @key(name: "byThing", fields: ["hash", "sender", "createdAt"]
    // 3. An automatic generated variable satisfy 1 and 2.
    // To handle this problem, We generate automatic variables by ourselves.

    const keyDirectives = parent.directives?.filter((dir) => dir.name.value === 'key')
    if (keyDirectives) {
      let useCreatedAtField = false
      let useUpdatedAtField = false
      let useTypeName = false

      let createdAtField: string | null = null
      let updatedAtField: string | null = null
      const timestamps = getArg(modelDirective, 'timestamps')
      switch (typeof timestamps) {
        case 'object':
          if (timestamps !== null) {
            createdAtField = timestamps['createdAt']
            updatedAtField = timestamps['updatedAt']
            if (createdAtField === undefined) {
              createdAtField = 'createdAt'
            }
            if (updatedAtField === undefined) {
              updatedAtField = 'updatedAt'
            }
          }
          break
        case 'undefined':
          createdAtField = 'createdAt'
          updatedAtField = 'updatedAt'
          break
        default:
          throw new Error('unreachable')
      }

      for (const kd of keyDirectives) {
        const fields = getArg(kd, 'fields')
        if (fields) {
          if (fields.includes(createdAtField)) {
            useCreatedAtField = true
          }
          if (fields.includes(updatedAtField)) {
            useUpdatedAtField = true
          }
          if (fields.includes('__typename')) {
            useTypeName = true
          }
        }
      }

      // Update create and update mutations
      const createResolverResourceId = ResolverResourceIDs.DynamoDBCreateResolverResourceID(typeName)
      this.updateResolver(
        ctx,
        createResolverResourceId,
        printBlock(`Prepare DynamoDB PutItem Request for @auto`)(
          compoundExpression([
            ...(useCreatedAtField && createdAtField
              ? [
                  qref(
                    `$context.args.input.put("${createdAtField}", $util.defaultIfNull($ctx.args.input.${createdAtField}, $util.time.nowISO8601()))`
                  ),
                ]
              : []),
            ...(useUpdatedAtField && updatedAtField
              ? [
                  qref(
                    `$context.args.input.put("${updatedAtField}", $util.defaultIfNull($ctx.args.input.${updatedAtField}, $util.time.nowISO8601()))`
                  ),
                ]
              : []),
            ...(useTypeName ? [qref(`$context.args.input.put("__typename", "${typeName}")`)] : []),
          ])
        )
      )

      const updateResolverResourceId = ResolverResourceIDs.DynamoDBUpdateResolverResourceID(typeName)
      this.updateResolver(
        ctx,
        updateResolverResourceId,
        printBlock(`Prepare DynamoDB UpdateItem Request for @auto`)(
          compoundExpression([
            ...(useUpdatedAtField && updatedAtField
              ? [
                  qref(
                    `$context.args.input.put("${updatedAtField}", $util.defaultIfNull($ctx.args.input.${updatedAtField}, $util.time.nowISO8601()))`
                  ),
                ]
              : []),
            ...(useTypeName ? [qref(`$context.args.input.put("__typename", "${typeName}")`)] : []),
          ])
        )
      )
    }
  }

  private updateCreateInput(
    ctx: TransformerContext,
    typeName: string,
    autoField: FieldDefinitionNode,
    nullable: boolean
  ) {
    this.updateInput(ctx, ModelResourceIDs.ModelCreateInputObjectName(typeName), typeName, autoField, nullable)
  }

  private updateUpdateInput(
    ctx: TransformerContext,
    typeName: string,
    autoField: FieldDefinitionNode,
    nullable: boolean
  ) {
    this.updateInput(ctx, ModelResourceIDs.ModelUpdateInputObjectName(typeName), typeName, autoField, nullable)
  }

  private updateInput(
    ctx: TransformerContext,
    inputName: string,
    typeName: string,
    autoField: FieldDefinitionNode,
    nullable: boolean
  ) {
    const input = ctx.getType(inputName)
    if (input && input.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) {
      if (input.fields) {
        if (nullable) {
          // make autoField nullable
          ctx.putType({
            ...input,
            fields: input.fields.map((f) => {
              if (f.name.value === autoField.name.value) {
                return makeInputValueDefinition(autoField.name.value, unwrapNonNull(autoField.type))
              }
              return f
            }),
          })
        } else {
          // or strip autoField
          const updatedFields = input.fields.filter((f) => f.name.value !== autoField.name.value)
          if (updatedFields.length === 0) {
            throw new InvalidDirectiveError(
              `After stripping away version field "${autoField.name.value}", \
                        the create input for type "${typeName}" cannot be created \
                        with 0 fields. Add another field to type "${typeName}" to continue.`
            )
          }
          ctx.putType({
            ...input,
            fields: updatedFields,
          })
        }
      }
    }
  }

  private updateResolver = (ctx: TransformerContext, resolverResourceId: string, code: string) => {
    const resolver = ctx.getResource(resolverResourceId)

    if (resolver) {
      const templateParts = [code, resolver!.Properties!.RequestMappingTemplate]
      resolver!.Properties!.RequestMappingTemplate = templateParts.join('\n\n')
      ctx.setResource(resolverResourceId, resolver)
    }
  }
}
