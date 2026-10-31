import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * The parts of a browsing session that are not rows of their own: the active
 * space, the tab each space last showed, and recently closed tabs. One JSON
 * value per name. Kept by `app/Desktop/session.ts`.
 */
export default defineModel({
  name: 'SessionValue',
  table: 'session_values',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'session_values_name_unique', columns: ['name'], unique: true },
  ],

  attributes: {
    name: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().max(64) },
    },
    value: {
      fillable: true,
      default: 'null',
      validation: { rule: schema.string() },
    },
  },
})
