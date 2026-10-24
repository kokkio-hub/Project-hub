import type { Catalog } from '../../shared/i18n/core.js';

/**
 * Dutch text for the server: error messages, emails, the calendar feed and
 * exports. Keys are the English text. Messages with {placeholders} are matched
 * against the finished English message (see translateMessage); a {what}
 * placeholder holds a word that is translated as well.
 */
export const serverNl: Catalog = {
  // ---------------------------------------------------------------------------
  // General errors
  // ---------------------------------------------------------------------------
  'Please sign in to continue.': 'Log in om verder te gaan.',
  'You don’t have permission to do that.': 'Je hebt geen toestemming om dat te doen.',
  '{what} not found.': '{what} niet gevonden.',
  'Invalid {what}.': 'Ongeldig {what}.',
  'The request body is not valid JSON.': 'De inhoud van het verzoek is geen geldige JSON.',
  'The request is too large.': 'Het verzoek is te groot.',
  'Something went wrong on the server. Please try again.': 'Er ging iets mis op de server. Probeer het opnieuw.',
  'Missing X-Requested-With header.': 'De X-Requested-With-header ontbreekt.',
  'Missing X-File-Name header.': 'De X-File-Name-header ontbreekt.',
  'Please choose a new password before continuing.': 'Kies eerst een nieuw wachtwoord.',
  'Only admins can do that.': 'Alleen beheerders kunnen dat doen.',
  'Guests can look and comment, but not change work.': 'Gasten kunnen meekijken en reageren, maar geen werk wijzigen.',
  'Only the project owner or an admin can {what}.': 'Alleen de projecteigenaar of een beheerder kan {what}.',

  // Words filled in above
  Item: 'Item',
  Task: 'Taak',
  Project: 'Project',
  User: 'Gebruiker',
  Column: 'Kolom',
  Label: 'Label',
  Comment: 'Reactie',
  Attachment: 'Bijlage',
  File: 'Bestand',
  Calendar: 'Agenda',
  Dependency: 'Afhankelijkheid',
  'Checklist item': 'Checklistitem',
  'Deleted task': 'Verwijderde taak',
  'Deleted project': 'Verwijderd project',
  Milestone: 'Mijlpaal',
  'Custom field': 'Eigen veld',
  'Saved view': 'Opgeslagen weergave',
  id: 'id',
  'task id': 'taak-id',
  'project id': 'project-id',
  'user id': 'gebruikers-id',
  'column id': 'kolom-id',
  'label id': 'label-id',
  'comment id': 'reactie-id',
  'attachment id': 'bijlage-id',
  'checklist item id': 'checklistitem-id',
  'column to move the tasks to': 'kolom om de taken naar te verplaatsen',
  'milestone id': 'mijlpaal-id',
  'field id': 'veld-id',
  'view id': 'weergave-id',
  'change project settings': 'projectinstellingen wijzigen',
  'change the board columns': 'de kolommen van het bord wijzigen',
  'change who is on a project': 'wijzigen wie er aan een project meedoet',
  'delete a project': 'een project verwijderen',
  'change the custom fields': 'de eigen velden wijzigen',
  'change the milestones': 'de mijlpalen wijzigen',

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  'Name is required': 'Vul een naam in',
  'Use at most 40 characters': 'Gebruik maximaal 40 tekens',
  'Use at most 100 characters': 'Gebruik maximaal 100 tekens',
  'Use at most 120 characters': 'Gebruik maximaal 120 tekens',
  'Use at most 200 characters': 'Gebruik maximaal 200 tekens',
  'Use at most 500 characters': 'Gebruik maximaal 500 tekens',
  'Use at most 5,000 characters': 'Gebruik maximaal 5.000 tekens',
  'Use at most 20,000 characters': 'Gebruik maximaal 20.000 tekens',
  'Use at most {count} characters': 'Gebruik maximaal {count} tekens',
  'Use at least {count} characters': 'Gebruik minstens {count} tekens',
  'Use at most 30 labels': 'Gebruik maximaal 30 labels',
  'Enter a valid email address': 'Vul een geldig e-mailadres in',
  'Email address is too long': 'Het e-mailadres is te lang',
  'Pick one of the available colours': 'Kies een van de beschikbare kleuren',
  'Role must be admin, member or guest': 'De rol moet beheerder, lid of gast zijn',
  'Use the format YYYY-MM-DD': 'Gebruik de notatie JJJJ-MM-DD',
  'Unknown status': 'Onbekende status',
  'Unknown status "{status}"': 'Onbekende status "{status}"',
  'Unknown priority': 'Onbekende prioriteit',
  'Unknown project status': 'Onbekende projectstatus',
  'The due date cannot be before the start date.': 'De deadline kan niet voor de startdatum liggen.',
  'Must be on or after the start date': 'Moet op of na de startdatum liggen',
  'At least 1': 'Minstens 1',
  'At most 365': 'Maximaal 365',
  'Choose email, link or password': 'Kies e-mail, link of wachtwoord',
  'Choose daily, weekly, monthly or yearly': 'Kies dagelijks, wekelijks, maandelijks of jaarlijks',
  'Choose instant, daily or off': 'Kies direct, dagelijks of uit',
  'Choose English or Nederlands': 'Kies English of Nederlands',
  'Choose team or private': 'Kies team of privé',
  'Give the task a title': 'Geef de taak een titel',
  'Give the project a name': 'Geef het project een naam',
  'Give the column a name': 'Geef de kolom een naam',
  'Give the label a name': 'Geef het label een naam',
  'Write something first': 'Schrijf eerst iets',
  'Say which column to move the task to': 'Geef aan naar welke kolom de taak moet',

  // ---------------------------------------------------------------------------
  // Signing in, passwords, links
  // ---------------------------------------------------------------------------
  'Enter your email address': 'Vul je e-mailadres in',
  'Enter your password': 'Vul je wachtwoord in',
  'Enter your current password': 'Vul je huidige wachtwoord in',
  'Enter the code from your authenticator app': 'Vul de code uit je authenticator-app in',
  'Incorrect email or password.': 'Onjuist e-mailadres of wachtwoord.',
  'This account has been deactivated. Please contact an administrator.': 'Dit account is gedeactiveerd. Neem contact op met een beheerder.',
  'This sign-in has expired. Enter your email and password again.': 'Deze inlogpoging is verlopen. Vul je e-mailadres en wachtwoord opnieuw in.',
  'That code isn’t right. Check the time on your phone and try again.': 'Die code klopt niet. Controleer de tijd op je telefoon en probeer het opnieuw.',
  'Incorrect code': 'Onjuiste code',
  'Setup has already been completed. Please sign in.': 'De installatie is al afgerond. Log in.',
  'To sign out on this device, use “Sign out”.': 'Gebruik “Uitloggen” om op dit apparaat uit te loggen.',
  'That session has already ended.': 'Die sessie is al beëindigd.',
  'Your password is incorrect.': 'Je wachtwoord klopt niet.',
  'Incorrect password': 'Onjuist wachtwoord',
  'Your current password is incorrect.': 'Je huidige wachtwoord klopt niet.',
  'Choose a password that is different from the current one.': 'Kies een ander wachtwoord dan je huidige.',
  'Must be different from your current password': 'Moet anders zijn dan je huidige wachtwoord',
  'Two-factor sign-in is already on.': 'Tweestapsverificatie staat al aan.',
  'Start the setup again: scan a new QR code first.': 'Begin opnieuw: scan eerst een nieuwe QR-code.',
  'Turn on two-factor sign-in first.': 'Zet eerst tweestapsverificatie aan.',
  'This link is incomplete. Copy the whole link from the email.': 'Deze link is onvolledig. Kopieer de hele link uit de e-mail.',
  'This invitation link has expired or has already been used. Ask your admin to send you a new one.':
    'Deze uitnodigingslink is verlopen of al gebruikt. Vraag je beheerder om een nieuwe.',
  'This password reset link has expired or has already been used. You can ask for a new one.':
    'Deze link om je wachtwoord te resetten is verlopen of al gebruikt. Je kunt een nieuwe aanvragen.',
  "Password reset by email isn't available here. Ask an admin to reset your password.":
    'Je wachtwoord resetten per e-mail kan hier niet. Vraag een beheerder om je wachtwoord te resetten.',
  'To change your own password, use your account settings.': 'Wijzig je eigen wachtwoord via je accountinstellingen.',
  "The reset link couldn't be emailed. {error}": 'De resetlink kon niet worden gemaild. {error}',

  // ---------------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------------
  "Email isn't set up on this server. Share an invite link instead, or set up email (see “Email” in the README).":
    'E-mail is niet ingesteld op deze server. Deel een uitnodigingslink, of stel e-mail in (zie “Email” in de README).',
  'Someone with this email address already has an account.': 'Iemand met dit e-mailadres heeft al een account.',
  'Already in use': 'Al in gebruik',
  'There must always be at least one active admin. Make someone else an admin first.':
    'Er moet altijd minstens één actieve beheerder zijn. Maak eerst iemand anders beheerder.',
  "You can't deactivate your own account.": 'Je kunt je eigen account niet deactiveren.',
  '{count} project': ['{count} project', '{count} projecten'],
  '{count} open task': ['{count} open taak', '{count} open taken'],
  '{name} owns {projects} and has {tasks}. Hand those over before making them a guest.':
    '{name} is eigenaar van {projects} en heeft {tasks}. Draag die eerst over voordat je diegene gast maakt.',
  '{name} owns {projects}. Hand those over before making them a guest.':
    '{name} is eigenaar van {projects}. Draag die eerst over voordat je diegene gast maakt.',
  '{name} has {tasks}. Hand those over before making them a guest.': '{name} heeft {tasks}. Draag die eerst over voordat je diegene gast maakt.',
  'Reassign their work first': 'Wijs hun werk eerst aan iemand anders toe',
  '{name} has already joined. To help them sign in, reset their password instead.':
    '{name} doet al mee. Reset hun wachtwoord als ze niet kunnen inloggen.',
  'Reactivate {name} before sending a new invitation.': 'Activeer {name} weer voordat je een nieuwe uitnodiging stuurt.',
  "Only invitations that haven't been accepted can be cancelled. To remove {name}'s access, deactivate the account.":
    'Alleen uitnodigingen die nog niet zijn geaccepteerd kun je intrekken. Deactiveer het account om {name} de toegang te ontnemen.',
  "{name} doesn't use two-factor sign-in.": '{name} gebruikt geen tweestapsverificatie.',
  "{name} hasn't accepted the invitation yet. Send a new invitation instead.":
    '{name} heeft de uitnodiging nog niet geaccepteerd. Stuur in plaats daarvan een nieuwe uitnodiging.',
  'Reactivate {name} first.': 'Activeer {name} eerst weer.',
  'Tasks can only be assigned to active team members.': 'Taken kunnen alleen aan actieve teamleden worden toegewezen.',
  'Unknown user': 'Onbekende gebruiker',
  'Unknown person': 'Onbekende persoon',
  '{name} isn’t on this private project. Add them to the project first.': '{name} doet niet mee aan dit privéproject. Voeg diegene eerst toe aan het project.',
  'Not on this project': 'Niet op dit project',
  'One of the selected people does not exist.': 'Een van de gekozen personen bestaat niet.',
  'The owner must be an active team member (not a guest).': 'De eigenaar moet een actief teamlid zijn (geen gast).',
  'Choose someone on the team': 'Kies iemand uit het team',

  // ---------------------------------------------------------------------------
  // Projects, columns, labels
  // ---------------------------------------------------------------------------
  'That project does not exist.': 'Dat project bestaat niet.',
  'Unknown project': 'Onbekend project',
  'Guests can’t create projects.': 'Gasten kunnen geen projecten aanmaken.',
  'That template does not exist.': 'Dat sjabloon bestaat niet.',
  'Unknown template': 'Onbekend sjabloon',
  'This project is archived.': 'Dit project is gearchiveerd.',
  'This project is archived. Restore it before changing its tasks.': 'Dit project is gearchiveerd. Zet het terug voordat je de taken wijzigt.',
  'Only the project owner or an admin can restore a project.': 'Alleen de projecteigenaar of een beheerder kan een project terugzetten.',
  'A board can have at most {count} columns.': 'Een bord kan maximaal {count} kolommen hebben.',
  'List every column of this board exactly once.': 'Noem elke kolom van dit bord precies één keer.',
  'A board needs at least one column for finished work (stage "Done").': 'Een bord heeft minstens één kolom voor afgerond werk nodig (fase "Klaar").',
  'Keep a Done column': 'Houd een Klaar-kolom',
  'A board needs at least one column for work that isn’t finished.': 'Een bord heeft minstens één kolom nodig voor werk dat nog niet af is.',
  'Keep an unfinished column': 'Houd een kolom voor onafgemaakt werk',
  'Choose another column of this board for its tasks.': 'Kies een andere kolom van dit bord voor de taken.',
  'Choose a column': 'Kies een kolom',
  'That column isn’t on this project’s board.': 'Die kolom staat niet op het bord van dit project.',
  'Unknown column': 'Onbekende kolom',
  'This project already has a label with that name.': 'Dit project heeft al een label met die naam.',
  'Already exists': 'Bestaat al',
  'Labels must belong to the task’s project.': 'Labels moeten bij het project van de taak horen.',
  'Unknown label': 'Onbekend label',

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------
  'That task does not exist.': 'Die taak bestaat niet.',
  'Unknown task': 'Onbekende taak',
  'Guests can’t delete tasks.': 'Gasten kunnen geen taken verwijderen.',
  'Only the person who created this task, the project owner or an admin can delete it.':
    'Alleen wie deze taak heeft aangemaakt, de projecteigenaar of een beheerder kan hem verwijderen.',
  'Only the person who created or deleted this task, the project owner or an admin can restore it.':
    'Alleen wie deze taak heeft aangemaakt of verwijderd, de projecteigenaar of een beheerder kan hem terugzetten.',
  'This task’s project “{name}” is in the trash. Restore the project instead.': 'Het project van deze taak, “{name}”, staat in de prullenbak. Zet het project terug.',
  'A checklist can have at most {count} items.': 'Een checklist kan maximaal {count} items hebben.',
  'List every checklist item exactly once.': 'Noem elk checklistitem precies één keer.',
  'A task can’t wait for itself.': 'Een taak kan niet op zichzelf wachten.',
  'Choose another task': 'Kies een andere taak',
  '“{title}” already waits for this task, so it can’t block it as well.': '“{title}” wacht al op deze taak, dus kan deze taak niet ook blokkeren.',
  'That would make a loop': 'Dat zou een kringloop maken',
  'A task can wait for at most {count} others.': 'Een taak kan op maximaal {count} andere taken wachten.',

  // Files
  'Files can be at most {size}.': 'Bestanden mogen maximaal {size} zijn.',
  'The upload was interrupted.': 'Het uploaden is onderbroken.',
  'The file name is not valid.': 'De bestandsnaam is ongeldig.',
  'The storage for attachments is full. Ask an admin to make room or raise the limit.':
    'De opslag voor bijlagen is vol. Vraag een beheerder om ruimte te maken of de limiet te verhogen.',
  'The file is empty.': 'Het bestand is leeg.',
  'Only the person who added this file, the project owner or an admin can remove it.':
    'Alleen wie dit bestand heeft toegevoegd, de projecteigenaar of een beheerder kan het verwijderen.',

  // Comments
  'You can only edit your own comments.': 'Je kunt alleen je eigen reacties bewerken.',
  'You can only delete your own comments.': 'Je kunt alleen je eigen reacties verwijderen.',

  // Admin
  'Backups aren’t set up yet. Add the BACKUP_S3_* variables (see “Backups” in the README).':
    'Back-ups zijn nog niet ingesteld. Voeg de BACKUP_S3_*-variabelen toe (zie “Backups” in de README).',

  // ---------------------------------------------------------------------------
  // Devices, calendar feed, exports
  // ---------------------------------------------------------------------------
  'Unknown device': 'Onbekend apparaat',
  '{browser} on {os}': '{browser} op {os}',
  'all tasks': 'alle taken',
  '{name}’s tasks': 'taken van {name}',
  '{priority} priority': 'prioriteit {priority}',
  ID: 'ID',
  Title: 'Titel',
  Stage: 'Fase',
  Priority: 'Prioriteit',
  Assignee: 'Toegewezen aan',
  Labels: 'Labels',
  'Start date': 'Startdatum',
  'Due date': 'Deadline',
  Created: 'Aangemaakt',
  Checklist: 'Checklist',
  Description: 'Beschrijving',

  // ---------------------------------------------------------------------------
  // Emails
  // ---------------------------------------------------------------------------
  'If the button doesn’t work, copy this address into your browser:': 'Werkt de knop niet? Kopieer dan dit adres naar je browser:',
  'Sent by {app}': 'Verstuurd door {app}',
  'Hi {name},': 'Hoi {name},',
  '{name} invited you to {app}': '{name} heeft je uitgenodigd voor {app}',
  'You’re invited to {app}': 'Je bent uitgenodigd voor {app}',
  'Choose a password to join {app}.': 'Kies een wachtwoord om mee te doen in {app}.',
  'Join {app}': 'Doe mee in {app}',
  'Your team': 'Je team',
  '{inviter} invited you to {app}, where the team plans and tracks its projects. Choose a password to join. You’ll sign in with {email}.':
    '{inviter} heeft je uitgenodigd voor {app}, waar het team zijn projecten plant en bijhoudt. Kies een wachtwoord om mee te doen. Je logt in met {email}.',
  'Accept invitation': 'Uitnodiging accepteren',
  'This link works for {count} day and can be used once.': [
    'Deze link werkt {count} dag en kan één keer worden gebruikt.',
    'Deze link werkt {count} dagen en kan één keer worden gebruikt.',
  ],
  'Weren’t expecting this? You can ignore this email.': 'Had je dit niet verwacht? Dan kun je deze e-mail negeren.',
  'Reset your {app} password': 'Je wachtwoord voor {app} resetten',
  'Choose a new password for {app}.': 'Kies een nieuw wachtwoord voor {app}.',
  'Choose a new password': 'Kies een nieuw wachtwoord',
  '{admin} sent you a link to choose a new password for {app}. You sign in with {email}.':
    '{admin} heeft je een link gestuurd om een nieuw wachtwoord te kiezen voor {app}. Je logt in met {email}.',
  'We received a request to reset the password for {email} on {app}.': 'We kregen een verzoek om het wachtwoord van {email} voor {app} te resetten.',
  'This link works for {count} minutes and can be used once.': 'Deze link werkt {count} minuten en kan één keer worden gebruikt.',
  'Your current password keeps working until you choose a new one.': 'Je huidige wachtwoord blijft werken tot je een nieuw kiest.',
  'Didn’t ask for this? You can ignore this email. Your password won’t change.':
    'Niet zelf aangevraagd? Dan kun je deze e-mail negeren. Je wachtwoord verandert niet.',
  'Test email from {app}': 'Test-e-mail van {app}',
  'Email is set up correctly.': 'E-mail is goed ingesteld.',
  'Email is working': 'E-mail werkt',
  'This is a test message from {app}. If you’re reading it, invitations and password reset emails will arrive too.':
    'Dit is een testbericht van {app}. Als je dit leest, komen uitnodigingen en e-mails om je wachtwoord te resetten ook aan.',
  'You received this because someone ran the send-test-email command on the server.':
    'Je krijgt dit omdat iemand het commando send-test-email op de server heeft uitgevoerd.',
  'Your day in {app}': 'Je dag in {app}',
  '{count} new notifications in {app}': '{count} nieuwe meldingen in {app}',
  'What needs your attention today.': 'Wat vandaag je aandacht nodig heeft.',
  'New activity on your tasks.': 'Nieuwe activiteit op je taken.',
  'Good morning, {name}': 'Goedemorgen, {name}',
  'New activity': 'Nieuwe activiteit',
  'Here’s what needs your attention today.': 'Dit heeft vandaag je aandacht nodig.',
  Overdue: 'Te laat',
  'Due today': 'Vandaag af',
  'Since yesterday': 'Sinds gisteren',
  'Open {app}': '{app} openen',
  'You get these emails once a day. Change this in your account settings.': 'Je krijgt deze e-mails één keer per dag. Wijzig dit in je accountinstellingen.',
  'You get these emails when something happens. Change this in your account settings.':
    'Je krijgt deze e-mails als er iets gebeurt. Wijzig dit in je accountinstellingen.',

  // Planning: subtasks, milestones, custom fields, saved views
  'Custom fields': 'Eigen velden',
  'Milestone in {project}': 'Mijlpaal in {project}',
  'Parent task': 'Hoofdtaak',
  Yes: 'Ja',
  'A dropdown needs at least one choice.': 'Een keuzelijst heeft minstens één keuze nodig.',
  'A project can have at most {max} custom fields.': 'Een project kan maximaal {max} eigen velden hebben.',
  'A project can have at most {max} milestones.': 'Een project kan maximaal {max} mijlpalen hebben.',
  'A subtask must belong to a task in the same project.': 'Een subtaak moet bij een taak in hetzelfde project horen.',
  'A task can have at most {max} subtasks.': 'Een taak kan maximaal {max} subtaken hebben.',
  'A task can’t be its own subtask.': 'Een taak kan niet zijn eigen subtaak zijn.',
  'Add a choice': 'Voeg een keuze toe',
  'Choose a main task': 'Kies een hoofdtaak',
  'Choose a task in this project': 'Kies een taak in dit project',
  'Choose board, list, timeline or calendar': 'Kies bord, lijst, tijdlijn of agenda',
  'Choose one of the options': 'Kies een van de opties',
  'Choose text, number, dropdown, date or checkbox': 'Kies tekst, getal, keuzelijst, datum of vinkje',
  'Enter a number': 'Vul een getal in',
  'Give the choice a name': 'Geef de keuze een naam',
  'Give the field a name': 'Geef het veld een naam',
  'Give the milestone a name': 'Geef de mijlpaal een naam',
  'Give the view a name': 'Geef de weergave een naam',
  'Has subtasks': 'Heeft subtaken',
  'List every field of this project exactly once.': 'Noem elk veld van dit project precies één keer.',
  'Subtasks can’t have subtasks of their own.': 'Subtaken kunnen zelf geen subtaken hebben.',
  'That field isn’t in this project.': 'Dat veld hoort niet bij dit project.',
  'That milestone isn’t in this project.': 'Die mijlpaal hoort niet bij dit project.',
  'These view settings are too long to save.': 'Deze weergave-instellingen zijn te lang om op te slaan.',
  'This project already has a field with that name.': 'Dit project heeft al een veld met die naam.',
  'This task has subtasks, so it can’t become a subtask itself.': 'Deze taak heeft subtaken en kan dus zelf geen subtaak worden.',
  'Too many subtasks': 'Te veel subtaken',
  'Unknown field': 'Onbekend veld',
  'Unknown milestone': 'Onbekende mijlpaal',
  'Use at most 2,000 characters': 'Gebruik maximaal 2.000 tekens',
  'Use at most 60 characters': 'Gebruik maximaal 60 tekens',
  'Use at most {max} choices': 'Gebruik maximaal {max} keuzes',
  'You can only reorder your own views.': 'Je kunt alleen je eigen weergaven herschikken.',
  'You can save at most {max} views.': 'Je kunt maximaal {max} weergaven opslaan.',
};
