'use strict';

/**
 * add value to a buddy's balance
 * @param {org.budblocks.addBalance} deposit - add value to the user's balance
 * @transaction
 */
async function addBalance(deposit) {
    let buddy = deposit.buddy;

    buddy.balance = buddy.balance + deposit.amount;

    const buddyRegistry = await getParticipantRegistry('org.budblocks.Buddy');
    buddyRegistry.update(buddy);
}

/**
 * remove value from a buddy's balance
 * @param {org.budblocks.removeBalance} withdrawl - remove value from the user's balance
 * @transaction
 */
async function removeBalance(withdrawl) {
    let buddy = withdrawl.buddy;

    if (buddy.balance - withdrawl.amount < 0) {
        let factory = getFactory();
        let event = factory.newEvent('org.budblocks', 'BalanceTooLow');
        event.balance = buddy.balance;
        event.amount = withdrawl.amount;
        emit(event);
        throw new Error('Balance Too Low');
    }

    buddy.balance = buddy.balance - withdrawl.amount;

    const buddyRegistry = await getParticipantRegistry('org.budblocks.Buddy');
    buddyRegistry.update(buddy);
}

/**
 * send a note from one buddy to another
 * @param {org.budblocks.sendNote} note_info - the trade to be processed
 * @transaction
 */
async function sendNote(note_info) {
    let sender = note_info.sender;
    let receiver = note_info.receiver;

    if (sender.username === receiver.username) {
        let factory = getFactory();
        let event = factory.newEvent('org.budblocks', 'InvalidNote');
        event.reason = 'recipient is the same as sender';
        emit(event);
        throw new Error('recipient is the same as sender');
    }
    // if (note_info.expiration_date.getTime() < note_info.timestamp.getTime()) {
    //     let factory = getFactory();
    //     let event = factory.newEvent('org.budblocks', 'InvalidNote');
    //     event.reason = 'due date is before current date';
    //     emit(event);
    //     throw new Error('due date is before current date');
    // }
    if (sender.earliest_note_index > -1) {
        let earliest_note = sender.notes_owed[sender.earliest_note_index];
        if (earliest_note.expiration_date.getTime() < note_info.timestamp.getTime()) {
            let event = factory.newEvent('org.budblocks', 'AccountFrozen');
            event.message = earliest_note.message;
            event.receiver_name = earliest_note.receiver.name;
            event.amount = earliest_note.amount;
            event.expiration_date = earliest_note.expiration_date;
            event.date_sent = earliest_note.date_sent;
            emit(event);
            // |
            // |
            // V
            throw new Error('Account Frozen');
            // ^
            // |
            // |
        }
    }

    console.log('no errors in checking for problems with the note info');

    let factory = getFactory();
    let note = factory.newResource('org.budblocks', 'Note', sender.username.concat('.').concat((sender.num_notes_sent++).toString()));
    note.sender = sender; //factory.newRelationship('org.budblocks', 'Buddy', sender.username);
    note.receiver = receiver; //factory.newRelationship('org.budblocks', 'Buddy', receiver.username);
    note.amount = note_info.amount;
    note.message = note_info.message;
    note.expiration_date = note_info.expiration_date;
    note.date_sent = note_info.timestamp;

    console.log('created note');

    // RJC - trying not creating a relationship during push, making an assumption that the type figures this out
    // receiver.notes_pending.push(factory.newRelationship('org.budblocks', 'Note', note.number));
    if (receiver.notes_pending){
        receiver.notes_pending.push(note);
    }
    else {
        receiver.notes_pending = [note];
    }
    if (sender.notes_waiting){
        sender.notes_waiting.push(note);
    }
    else {
        sender.notes_waiting = [note];
    }

    console.log('note pushed');

    const noteRegistry = await getAssetRegistry('org.budblocks.Note');
    noteRegistry.add(note);

    const buddyRegistry = await getParticipantRegistry('org.budblocks.Buddy');
    buddyRegistry.update(receiver);
    buddyRegistry.update(sender);

    console.log('registries updated');

    let event = factory.newEvent('org.budblocks', 'NoteSent');
    event.sender = sender.username;
    event.receiver = receiver.username;
    event.amount = note_info.amount;
    event.message = note_info.message;
    event.expiration_date = note_info.expiration_date;
    event.date_sent = note_info.timestamp;
    event.note_number = note.number;
    emit(event);

    console.log('success');
}

/**
 * reject a note the user was sent by another buddy
 * @param {org.budblocks.rejectNote} trade - the trade to be processed
 * @transaction
 */
async function rejectNote(trade) {
    let note = trade.note; // just for ease of use
    let sender = note.sender;
    let receiver = note.receiver;

    //if the note is already accepted
    if (note.accepted) {
        throw new Error('Note already accepted');
    }
    //if note is not in pending notes
    if (receiver.notes_pending.indexOf(note) < 0) {
        throw new Error('Note not in pending notes');
    }
    //if note is not in waiting notes
    if (sender.notes_waiting.indexOf(note) < 0) {
        throw new Error('Note not in waiting notes');
    }

    let noteRegistry = await getAssetRegistry('org.budblocks.Note');
    noteRegistry.remove(note);

    sender.notes_waiting.splice(sender.notes_waiting.indexOf(note), 1);
    receiver.notes_pending.splice(receiver.notes_pending.indexOf(note), 1);

    let buddyRegistry = await getParticipantRegistry('org.budblocks.Buddy');
    buddyRegistry.update(receiver);

    let factory = getFactory();
    let event = factory.newEvent('org.budblocks', 'NoteRejected');
    event.sender = sender.username;
    event.receiver = receiver.username;
    event.amount = note.amount;
    event.message = note.message;
    event.expiration_date = note.expiration_date;
    event.date_sent = note.date_sent;
    event.note_number = note.number;
    emit(event);
}

/**
 * accept a note the user was sent by another buddy
 * @param {org.budblocks.acceptNote} trade - the trade to be processed
 * @transaction
 */
async function acceptNote(trade) {
    let note = trade.note; // just for ease of use
    let sender = note.sender;
    let receiver = note.receiver;

    // let participantRegistry = await getParticipantRegistry('org.budblocks.Buddy');
    // let receiver = await participantRegistry.get(receiver2.username);

    //if the note is already accepted
    if (note.accepted) {
        throw new Error('Note already accepted');
    }
    // if note is not in pending notes
    if (receiver.notes_pending.indexOf(note) < 0) {
        throw new Error('Note not in pending notes');
    }
    //if note is not in waiting notes
    if (sender.notes_waiting.indexOf(note) < 0) {
        throw new Error('Note not in waiting notes');
    }
    if (trade.timestamp.getTime() - note.date_sent.getTime() > 86400000) {
        // |
        // |
        // V
        throw new Error('Note Expired');
        // ^
        // |
        // |
    }

    note.accepted = true;

    let factory = getFactory();

    if (sender.notes_owed) {
        sender.notes_owed.push(note);
    }
    else {
        sender.notes_owed = [note];
    }

    if (receiver.notes_received) {
        receiver.notes_received.push(note);
    }
    else {
        receiver.notes_received = [note];
    }

    sender.notes_waiting.splice(sender.notes_waiting.indexOf(note), 1);
    receiver.notes_pending.splice(receiver.notes_pending.indexOf(note), 1);

    if (sender.earliest_note_index > -1) {
        let earliest_note = sender.notes_owed[sender.earliest_note_index];
        if (note.expiration_date.getTime() < earliest_note.expiration_date.getTime()) {
            sender.earliest_note_index = sender.notes_owed.length - 1;
        }
    }
    else {
        sender.earliest_note_index = 0;
    }

    // update
    const noteRegistry = await getAssetRegistry('org.budblocks.Note');
    noteRegistry.update(note);

    const buddyRegistry = await getParticipantRegistry('org.budblocks.Buddy');
    buddyRegistry.update(sender);
    buddyRegistry.update(receiver);

    let event = factory.newEvent('org.budblocks', 'NoteAccepted');
    event.sender = sender.username;
    event.receiver = receiver.username;
    event.amount = note.amount;
    event.message = note.message;
    event.expiration_date = note.expiration_date;
    event.date_sent = note.date_sent;
    event.note_number = note.number;
    emit(event);
}

/**
 * resolve a note the user owes another buddy
 * @param {org.budblocks.resolveNote} trade - the trade to be processed
 * @transaction
 */
async function resolveNote(trade) {
    let note = trade.note; // just for ease of use
    let sender = note.sender;
    let receiver = note.receiver;

    //check balance
    if (sender.balance - note.amount < 0) {
        let factory = getFactory();
        let event = factory.newEvent('org.budblocks', 'BalanceTooLow');
        event.balance = sender.balance;
        event.amount = note.amount;
        emit(event);
        throw new Error('Balance Too Low');
    }

    //check accepted, check in notes_owed and notes_received
    if (!note.accepted) {
        throw new Error('Note not accepted by the recipient');
    }
    if (!sender.notes_owed.includes(note)) {
        throw new Error('Note not in sent notes of sender');
    }
    if (!receiver.notes_received.includes(note)) {
        throw new Error('Note not in received notes of recipient');
    }

    //move balance
    sender.balance = sender.balance - note.amount;
    receiver.balance = receiver.balance + note.amount;

    //get new earliest note of sender
    if (sender.notes_owed.length > 1) {
        let earliest_note = sender.notes_owed[sender.earliest_note_index];
        if (note.number === earliest_note.number) {
            let new_earliest = sender.notes_owed[0];
            let new_earliest_index = sender.earliest_note_index > 0 ? 0 : 1;
            for (let i = new_earliest_index === 0 ? 1 : 0; i < sender.notes_owed.length; ++i) {
                if (i === sender.earliest_note_index) {
                    continue;
                }
                else if (sender.notes_owed[i].expiration_date.getTime() < new_earliest.expiration_date.getTime()) {
                    new_earliest = sender.notes_owed[i];
                    new_earliest_index = i;
                }
            }
            sender.earliest_note_index = new_earliest_index;
        }
    }
    else {
        sender.earliest_note_index = -1;
    }

    //remove note from sender-receiver notes
    let sender_index = sender.notes_owed.indexOf(note);
    if (sender.earliest_note_index > sender_index) {
        --sender.earliest_note_index;
    }
    sender.notes_owed.splice(sender_index, 1);
    receiver.notes_received.splice(receiver.notes_received.indexOf(note), 1);

    //check if the note was overdue
    if (note.expiration_date.getTime() - trade.timestamp.getTime() < 0) {
        sender.time_over.push(trade.timestamp.getTime() - note.expiration_date.getTime());
        sender.amount_over.push(note.amount);
        sender.date_over.push(note.expiration_date);
    }

    //delete note
    const noteRegistry = await getAssetRegistry('org.budblocks.Note');
    noteRegistry.remove(note);

    //update buddyRegistry
    const buddyRegistry = await getParticipantRegistry('org.budblocks.Buddy');
    buddyRegistry.update(sender);
    buddyRegistry.update(receiver);

    //emit event
    let factory = getFactory();
    let event = factory.newEvent('org.budblocks', 'NoteResolved');
    event.sender = sender.username;
    event.receiver = receiver.username;
    event.amount = note.amount;
    event.message = note.message;
    event.expiration_date = note.expiration_date;
    event.date_sent = note.date_sent;
    event.note_number = note.number;
    emit(event);
}
