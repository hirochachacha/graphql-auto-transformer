import {ObjectTypeDefinitionNode, parse, DocumentNode, TypeNode, Kind, InputObjectTypeDefinitionNode} from 'graphql'
import {GraphQLTransform} from 'graphql-transformer-core'
import {AutoTransformer} from '../AutoTransformer'
import {DynamoDBModelTransformer} from 'graphql-dynamodb-transformer'
import {KeyTransformer} from 'graphql-key-transformer'
import {ModelAuthTransformer} from 'graphql-auth-transformer'

const getInputType =
  (schemaDoc: DocumentNode) =>
  (name: string): InputObjectTypeDefinitionNode =>
    schemaDoc.definitions.find(
      (d) => d.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION && d.name.value === name
    ) as InputObjectTypeDefinitionNode
const getInputField = (input: InputObjectTypeDefinitionNode, field: string) =>
  input.fields?.find((f) => f.name.value === field)
const getType =
  (schemaDoc: DocumentNode) =>
  (name: string): ObjectTypeDefinitionNode =>
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

test('@auto define timestamps before using it', () => {
  const validSchema = `
    type Post @model(timestamps: {updatedAt: "updatedDate"})
    @key(fields: ["title", "updatedDate"])
    {
        title: String!
        updatedDate: String! @auto
    }
    `
  const transformer = new GraphQLTransform({
    transformers: [new DynamoDBModelTransformer(), new KeyTransformer(), new AutoTransformer()],
  })
  const out = transformer.transform(validSchema)

  const updatePostVTL = out.resolvers['Mutation.updatePost.req.vtl']
  expect(
    updatePostVTL.indexOf('$context.args.input.put("updatedDate"') <
      updatePostVTL.indexOf('$ctx.args.input.updatedDate')
  )
})

test('@auto define owner before using it', () => {
  const validSchema = `
    type Post @model
    @key(fields: ["owner", "updatedAt"])
    @auth(rules: [
      # Defaults to use the "owner" field.
      { allow: owner },
      # Authorize the update mutation and both queries.
      { allow: owner, ownerField: "editors", operations: [update, read] }
    ])
    {
        title: String!
        editors: [String]
        owner: ID! @auto
        updatedAt: String! @auto
    }
    `
  const transformer = new GraphQLTransform({
    transformers: [
      new DynamoDBModelTransformer(),
      new KeyTransformer(),
      new AutoTransformer(),
      new ModelAuthTransformer({
        authConfig: {
          defaultAuthentication: {
            authenticationType: 'AMAZON_COGNITO_USER_POOLS',
          },
          additionalAuthenticationProviders: [],
        },
      }),
    ],
  })
  const out = transformer.transform(validSchema)

  const createPostVTL = out.resolvers['Mutation.createPost.req.vtl']
  const updatePostVTL = out.resolvers['Mutation.updatePost.req.vtl']
  expect(createPostVTL.indexOf('$context.args.input.put("owner"') < createPostVTL.indexOf('$ctx.args.input.owner'))
  expect(updatePostVTL.indexOf('$context.args.input.put("owner"') < updatePostVTL.indexOf('$ctx.args.input.owner'))
})

test('@auto strip target field of CreateXXXInput and UpdateXXXInput', () => {
  const validSchema = `
    type Post @model {
        id: ID!
        title: String!
        createdAt: String! @auto
        owner: ID! @auto
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
