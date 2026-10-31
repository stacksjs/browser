import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * One page in the browser's history: a row per address, not per visit. The
 * last ten visit times stand for the rest when ranking (see `frecency` in
 * `resources/functions/browser/rank.ts`), so the table stays one row per page
 * however often it is opened.
 *
 * The app's own database (`app/Desktop/history.ts`) is opened from this model;
 * nothing serves it over a public API.
 */
export default defineModel({
  name: 'HistoryEntry',
  table: 'history_entries',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'history_entries_url_unique', columns: ['url'], unique: true },
    { name: 'history_entries_last_visit_at_index', columns: ['last_visit_at'] },
  ],

  attributes: {
    url: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().max(8192) },
    },
    host: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(255) },
    },
    title: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(1024) },
    },
    visits: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
    },
    /** A JSON array of the last ten visit times, in milliseconds, newest first. */
    recentVisits: {
      fillable: true,
      default: '[]',
      validation: { rule: schema.string() },
    },
    lastVisitAt: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
    },
  },
})
