import type { Catalog } from './core.js';

/**
 * Dutch text for strings used by both the web app and the server: stages,
 * priorities, roles, project health, repeats and notification sentences.
 * Keys are the English text. Informal "je", like most Dutch software.
 */
export const sharedNl: Catalog = {
  // Stages, priorities, statuses and roles
  'To do': 'Te doen',
  'In progress': 'Bezig',
  'In review': 'In review',
  Done: 'Klaar',
  Low: 'Laag',
  Medium: 'Gemiddeld',
  High: 'Hoog',
  Urgent: 'Urgent',
  Active: 'Actief',
  'On hold': 'Gepauzeerd',
  Completed: 'Afgerond',
  Archived: 'Gearchiveerd',
  Admin: 'Beheerder',
  Member: 'Lid',
  Guest: 'Gast',

  // Project health
  'Project completed': 'Project afgerond',
  'Project archived': 'Project gearchiveerd',
  'All tasks are done': 'Alle taken zijn klaar',
  'Past its due date by {count} day': ['{count} dag over de deadline', '{count} dagen over de deadline'],
  '{count} overdue task': ['{count} taak te laat', '{count} taken te laat'],
  '{time} of the time used, {done} of tasks done': '{time} van de tijd gebruikt, {done} van de taken klaar',
  'No tasks yet': 'Nog geen taken',
  'No due date set': 'Geen deadline ingesteld',
  'On schedule': 'Op schema',

  // Repeating tasks
  'Every day': ['Elke dag', 'Elke {count} dagen'],
  'Every week': ['Elke week', 'Elke {count} weken'],
  'Every month': ['Elke maand', 'Elke {count} maanden'],
  'Every year': ['Elk jaar', 'Elke {count} jaar'],

  // Notifications
  Someone: 'Iemand',
  'a task': 'een taak',
  '{actor} assigned {task} to you': '{actor} heeft {task} aan je toegewezen',
  '{actor} mentioned you on {task}': '{actor} noemde je bij {task}',
  '{actor} commented on {task}': '{actor} reageerde op {task}',
  '{actor} completed {task}': '{actor} heeft {task} afgerond',
  '{task} is ready to start: everything it was waiting for is done': '{task} kan beginnen: alles waar het op wachtte is klaar',
  '{task} is due tomorrow': '{task} moet morgen af',
  '{actor} changed {task}': '{actor} heeft {task} gewijzigd',
};
