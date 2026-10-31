import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * What the browser remembers about one site: the ad blocker on or off, its
 * zoom, and the answers to its camera and microphone requests. Mirrors
 * `SiteSettings` in `resources/functions/browser/sites.ts`; kept by
 * `app/Desktop/sites.ts`.
 */
export default defineModel({
  name: 'SiteSetting',
  table: 'site_settings',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'site_settings_host_unique', columns: ['host'], unique: true },
  ],

  attributes: {
    host: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().max(255) },
    },
    blocking: {
      fillable: true,
      default: true,
      validation: { rule: schema.boolean() },
    },
    zoom: {
      fillable: true,
      default: 1,
      validation: { rule: schema.number().min(0.25).max(5) },
    },
    camera: {
      fillable: true,
      default: 'ask',
      validation: { rule: schema.enum(['ask', 'allow', 'deny']) },
    },
    microphone: {
      fillable: true,
      default: 'ask',
      validation: { rule: schema.enum(['ask', 'allow', 'deny']) },
    },
  },
})
