import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A space in the sidebar: a name, an icon, a theme and the profile whose
 * cookies its tabs use. `uid` is the id the screen made for it
 * (`resources/functions/browser/sidebar.ts`), so rows and screen state agree
 * without a round trip. Kept by `app/Desktop/session.ts`.
 */
export default defineModel({
  name: 'Space',
  table: 'spaces',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'spaces_uid_unique', columns: ['uid'], unique: true },
  ],

  attributes: {
    uid: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().max(64) },
    },
    name: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(255) },
    },
    /** An emoji or an SF Symbol name; empty for none. */
    icon: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(64) },
    },
    profile: {
      fillable: true,
      default: 'default',
      validation: { rule: schema.string().max(64) },
    },
    /** The light and dark palettes, as JSON. */
    theme: {
      fillable: true,
      default: '{}',
      validation: { rule: schema.string() },
    },
    /** Where it sits in the space switcher, from 0. */
    position: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
    },
  },
})
