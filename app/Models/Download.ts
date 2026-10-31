import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A file a page downloaded, as the Library and the downloads popover list it.
 * Craft saves it to ~/Downloads and reports its progress; a row records where
 * it went and how it ended. Kept by `app/Desktop/downloads.ts`.
 */
export default defineModel({
  name: 'Download',
  table: 'downloads',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'downloads_uid_unique', columns: ['uid'], unique: true },
    { name: 'downloads_started_at_index', columns: ['started_at'] },
  ],

  attributes: {
    /** Craft's id for the download. */
    uid: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().max(64) },
    },
    url: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(8192) },
    },
    /** Where the file was saved. */
    path: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(4096) },
    },
    name: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(1024) },
    },
    state: {
      fillable: true,
      default: 'started',
      validation: { rule: schema.enum(['started', 'finished', 'failed', 'cancelled']) },
    },
    /** Bytes so far, and in all (0 when the server did not say). */
    received: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0) },
    },
    total: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0) },
    },
    startedAt: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0) },
    },
    finishedAt: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number().min(0) },
    },
  },
})
