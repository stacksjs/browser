import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A site's Boost: its own CSS and JS, and elements zapped off it. Mirrors
 * `Boost` in `resources/functions/browser/boosts.ts`; kept by
 * `app/Desktop/boosts.ts`.
 */
export default defineModel({
  name: 'Boost',
  table: 'boosts',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'boosts_uid_unique', columns: ['uid'], unique: true },
  ],

  attributes: {
    uid: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().max(64) },
    },
    host: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().max(255) },
    },
    name: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(255) },
    },
    css: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(200000) },
    },
    js: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(200000) },
    },
    /** JSON array of selectors. */
    zapped: {
      fillable: true,
      default: '[]',
      validation: { rule: schema.string().max(200000) },
    },
    enabled: {
      fillable: true,
      default: true,
      validation: { rule: schema.boolean() },
    },
  },
})
