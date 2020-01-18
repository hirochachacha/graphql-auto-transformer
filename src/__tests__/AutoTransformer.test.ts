import {ObjectTypeDefinitionNode, parse, DocumentNode, TypeNode, Kind, InputObjectTypeDefinitionNode} from 'graphql'
import {GraphQLTransform} from 'graphql-transformer-core'
import {AutoTransformer} from '../AutoTransformer'
import {DynamoDBModelTransformer} from 'graphql-dynamodb-transformer'

const getInputType = (schemaDoc: DocumentNode) => (name: string): InputObjectTypeDefinitionNode =>
  schemaDoc.definitions.find(
    (d) => d.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION && d.name.value === name
  ) as InputObjectTypeDefinitionNode
const getInputField = (input: InputObjectTypeDefinitionNode, field: string) =>
  input.fields?.find((f) => f.name.value === field)
const getType = (schemaDoc: DocumentNode) => (name: string): ObjectTypeDefinitionNode =>
  schemaDoc.definitions.find(
    (d) => d.kind === Kind.OBJECT_TYPE_DEFINITION && d.name.value === name
  ) as ObjectTypeDefinitionNode
const getField = (input: ObjectTypeDefinitionNode, field: string) => input.fields?.find((f) => f.name.value === field)
const typeToString = (t?: TypeNode): string => {
  if (!t) {
    return '<undefined>'
  }
  switch (t.kind) {
    case 'NamedType':
      return t.name.value
    case 'ListType':
      return `[${typeToString(t.type)}]`
    case 'NonNullType':
      return `${typeToString(t.type)}!`
  }
}

test('@auto strip target field of CreateXXXInput and UpdateXXXInput', () => {
  const validSchema = `
    type Post @model {
        id: ID!
        title: String!
        createdAt: String! @auto
    }
    `
  const transformer = new GraphQLTransform({
    transformers: [new DynamoDBModelTransformer(), new AutoTransformer()],
  })
  const out = transformer.transform(validSchema)
  const schemaDoc = parse(out.schema)
  expect(out).toBeDefined()
  expect(typeToString(getField(getType(schemaDoc)('Post'), 'createdAt')?.type)).toBe('String!')
  expect(getInputField(getInputType(schemaDoc)('CreatePostInput'), 'createdAt')).toBeUndefined()
  expect(getInputField(getInputType(schemaDoc)('UpdatePostInput'), 'createdAt')).toBeUndefined()
})

test('@auto(creatable: true) strip target field of UpdateXXXInput', () => {
  const validSchema = `
    type Post @model {
        id: ID!
        title: String!
        createdAt: String! @auto(creatable: true)
    }
    `
  const transformer = new GraphQLTransform({
    transformers: [new DynamoDBModelTransformer(), new AutoTransformer()],
  })
  const out = transformer.transform(validSchema)
  const schemaDoc = parse(out.schema)

  expect(out).toBeDefined()
  expect(typeToString(getField(getType(schemaDoc)('Post'), 'createdAt')?.type)).toBe('String!')
  expect(typeToString(getInputField(getInputType(schemaDoc)('CreatePostInput'), 'createdAt')?.type)).toBe('String')
  expect(getInputField(getInputType(schemaDoc)('UpdatePostInput'), 'createdAt')).toBeUndefined()
})

test('@auto fails without @model.', () => {
  const validSchema = `
    type Post {
        id: ID!
        title: String!
        version: String!
        createdAt: String! @auto
    }
    `
  try {
    const transformer = new GraphQLTransform({
      transformers: [new DynamoDBModelTransformer(), new AutoTransformer()],
    })
    transformer.transform(validSchema)
  } catch (e) {
    expect(e.name).toEqual('InvalidDirectiveError')
  }
})

test('@auto fails when target field is nullable.', () => {
  const validSchema = `
    type Post @model {
        id: ID!
        title: String!
        version: String!
        createdAt: String @auto
    }
    `
  try {
    const transformer = new GraphQLTransform({
      transformers: [new DynamoDBModelTransformer(), new AutoTransformer()],
    })
    transformer.transform(validSchema)
  } catch (e) {
    expect(e.name).toEqual('TransformerContractError')
  }
})
