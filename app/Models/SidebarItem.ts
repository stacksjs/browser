import { defineModel } from '@stacksjs/orm'
import { schema } from '@stacksjs/validation'

/**
 * A row of the sidebar: a tab, folder or split view, in Favorites or in a
 * space's Pinned or Today list. Mirrors `Item` in
 * `resources/functions/browser/sidebar.ts`, with an empty string where the
 * screen has null. A tab that leaves the sidebar (closed, cleared, archived)
 * keeps its row with `archivedAt` set, which is what the Library lists.
 * Kept by `app/Desktop/session.ts`.
 */
export default defineModel({
  name: 'SidebarItem',
  table: 'sidebar_items',
  primaryKey: 'id',
  autoIncrement: true,

  indexes: [
    { name: 'sidebar_items_uid_unique', columns: ['uid'], unique: true },
    { name: 'sidebar_items_archived_at_index', columns: ['archived_at'] },
  ],

  attributes: {
    uid: {
      required: true,
      fillable: true,
      validation: { rule: schema.string().max(64) },
    },
    kind: {
      fillable: true,
      default: 'tab',
      validation: { rule: schema.enum(['tab', 'folder', 'split']) },
    },
    section: {
      fillable: true,
      default: 'today',
      validation: { rule: schema.enum(['favorites', 'pinned', 'today']) },
    },
    /** The space's uid; empty for a favorite, which every space shows. */
    spaceUid: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(64) },
    },
    /** The folder or split view holding it; empty at the top of its list. */
    parentUid: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(64) },
    },
    /** Sorts it among its siblings (`resources/functions/browser/order.ts`). */
    sortKey: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(255) },
    },
    title: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(1024) },
    },
    /** A name the person gave a tab, shown instead of its page's title. */
    name: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(1024) },
    },
    url: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(8192) },
    },
    /** Where a pinned tab or favorite returns to when it is reset. */
    savedUrl: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(8192) },
    },
    icon: {
      fillable: true,
      default: '',
      validation: { rule: schema.string().max(8192) },
    },
    collapsed: {
      fillable: true,
      default: false,
      validation: { rule: schema.boolean() },
    },
    createdAt: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
    },
    lastActiveAt: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
    },
    /** When it left the sidebar; 0 while it is in it. */
    archivedAt: {
      fillable: true,
      default: 0,
      validation: { rule: schema.number() },
    },
  },
})
