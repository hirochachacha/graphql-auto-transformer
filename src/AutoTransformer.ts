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
import {ModelResourceIDs, isNonNullType, makeInputValueDefinition, unwrapNonNull} from 'graphql-transformer-common'

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
    const getArg = (arg: string, dflt?: any): any => {
      const argument = directive.arguments?.find(isArg(arg))
      return argument ? valueFromASTUntyped(argument.value) : dflt
    }

    const creatable = getArg('creatable', false)
    const updatable = getArg('updatable', false)

    this.updateCreateInput(ctx, parent.name.value, definition, creatable)
    this.updateUpdateInput(ctx, parent.name.value, definition, updatable)
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
}
