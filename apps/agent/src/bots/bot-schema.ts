import { Type } from 'typebox'
import { AVATAR_VARIANTS } from '@kklyeenook/shared/bot/bot'

const color = Type.String({ pattern: '^#[0-9a-fA-F]{6}$' })
const id = Type.String({ minLength: 1, maxLength: 200 })
const nullableId = Type.Union([id, Type.Null()])
export const botSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    role: Type.Optional(Type.String({ maxLength: 500 })),
    kind: Type.Optional(Type.Union([Type.Literal('personal'), Type.Literal('coding')])),
    instructions: Type.Optional(Type.String({ maxLength: 64000 })),
    model: Type.Optional(
      Type.Union([
        Type.Object({ provider: id, modelId: id }, { additionalProperties: false }),
        Type.Null(),
      ]),
    ),
    thinkingLevel: Type.Optional(
      Type.Union([
        Type.Null(),
        ...(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map((level) =>
          Type.Literal(level),
        ),
      ]),
    ),
    enabledTools: Type.Optional(Type.Array(id, { maxItems: 500 })),
    workspaceIds: Type.Optional(Type.Array(id, { maxItems: 500 })),
    defaultWorkspaceId: Type.Optional(nullableId),
    permissionMode: Type.Optional(
      Type.Union([
        Type.Literal('read-only'),
        Type.Literal('workspace-write'),
        Type.Literal('full-access'),
      ]),
    ),
    avatar: Type.Optional(
      Type.Object(
        {
          seed: id,
          variant: Type.Union(AVATAR_VARIANTS.map((variant) => Type.Literal(variant))),
          colors: Type.Array(color, { minItems: 2, maxItems: 8 }),
          accentColor: color,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)
