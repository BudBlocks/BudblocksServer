/**
 * add value to a buddy's balance
 * @param {org.budblocks.addBalance} deposit - add value to the user's balance
 * @transaction
 */
async function addBalance(deposit) {
    let buddy = deposit.buddy;

    buddy.balance = buddy.balance + deposit.amount;

    let buddyRegistry = await getParticipantRegistry('org.budblocks.Buddy');
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

    let buddyRegistry = await getParticipantRegistry('org.budblocks.Buddy');
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
    if (note_info.expiration_date.getTime() < note_info.timestamp.getTime()) {
        let factory = getFactory();
        let event = factory.newEvent('org.budblocks', 'InvalidNote');
        event.reason = 'due date is before current date';
        emit(event);
        throw new Error('due date is before current date');
    }
    if (sender.earliest_note_index > -1) {
        let earliest_note = sender.notes_sent[sender.earliest_note_index];
        if (earliest_note.expiration_date.getTime() < note_info.timestamp.getTime()) {
            let event = factory.newEvent('org.budblocks', 'AccountFrozen');
            event.field = earliest_note.field;
            event.reciever_name = earliest_note.reciever.name;
            event.amount = earliest_note.amount;
            event.expiration_date = earliest_note.expiration_date;
            event.date_sent = earliest_note.date_sent;
            emit(event);
            throw new Error('Account Frozen');
        }
    }

    let factory = getFactory();
    let note = factory.newResource('org.budblocks', 'Note', sender.username.concat('.').concat((sender.notes_sent++).to_string()));
    note.sender = factory.newRelationship('org.budblocks', 'Buddy', sender.username);
    note.receiver = factory.newRelationship('org.budblocks', 'Buddy', receiver.username);
    note.amount = note_info.amount;
    note.field = note_info.field;
    note.expiration_date = note_info.expiration_date;
    note.date_sent = note_info.timestamp;

    let noteRegistry = await getAssetRegistry('org.budblocks.Note');
    noteRegistry.add(note);

    let event = factory.newEvent('org.budblocks', 'NoteSent');
    event.sender = sender.name;
    event.reciever = receiver.name;

    event.amount = note_info.amount;
    event.field = note_info.field;
    event.expiration_date = note_info.expiration_date;
    event.date_sent = note_info.timestamp;
    event.note_number = note.number;
    emit(event);
}

/**
 * resolve a note the user owes another buddy
 * @param {org.budblocks.acceptNote} trade - the trade to be processed
 * @transaction
 */
async function acceptNote(trade) {
    let note = trade.note; // just for ease of use
    let sender = note.sender;
    let receiver = note.receiver;

    note.accepted = true;

    let noteRegistry = await getAssetRegistry('org.budblocks.Note');
    noteRegistry.update(note);

    let factory = getFactory();
    sender.notes_sent.push(factory.newRelationship('org.budblocks', 'Note', note.ID));
    receiver.notes_owed.push(sender.notes_sent[sender.notes_sent.length - 1]);

    if (sender.earliest_note_index > -1) {
        let earliest_note = sender.notes_sent[sender.earliest_note_index];
        if (note.expiration_date.getTime() < earliest_note.expiration_date.getTime()) {
            sender.earliest_note_index = sender.notes_sent.length - 1;
        }
    }
    else {
        sender.earliest_note_index = 0;
    }

    let buddyRegistry = await getParticipantRegistry('org.budblocks.Buddy');
    buddyRegistry.update(sender);
    buddyRegistry.update(receiver);

    let event = factory.newEvent('org.budblocks', 'NoteAccepted');
    event.sender = sender.name;
    event.reciever = receiver.name;
    event.amount = note.amount;
    event.field = note.field;
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

    //move balance
    sender.balance = sender.balance - note.amount;
    receiver.balance = receiver.balance - note.amount;

    //get new earliest note of sender
    if (sender.notes_sent.length > 1) {
        let earliest_note = sender.notes_sent[sender.earliest_note_index];
        if (note.number === earliest_note.number) {
            let new_earliest = sender.notes_sent[0];
            let new_earliest_index = sender.earliest_note_index > 0 ? 0 : 1;
            for (let i = new_earliest_index === 0 ? 1 : 0; i < sender.notes_sent.length; ++i) {
                if (i === sender.earliest_note_index) {
                    continue;
                }
                else if (sender.notes_sent[i].expiration_date.getTime() < new_earliest.expiration_date.getTime()) {
                    new_earliest = sender.notes_sent[i];
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
    let sender_index = sender.notes_sent.indexOf(note);
    if (sender.earliest_note_index > sender_index) {
        --sender.earliest_note_index;
    }
    sender.notes_sent.splice(sender_index);
    receiver.notes_owed.splice(receiver.notes_owed.indexOf(note));

    //delete note
    let noteRegistry = await getAssetRegistry('org.budblocks.Note');
    noteRegistry.remove(note);

    //update buddyRegistry
    let buddyRegistry = await getParticipantRegistry('org.budblocks.Buddy');
    buddyRegistry.update(sender);
    buddyRegistry.update(receiver);

    //emit event
    let factory = getFactory();
    let event = factory.newEvent('org.budblocks', 'NoteResolved');
    event.sender = sender.name;
    event.reciever = receiver.name;
    event.amount = note.amount;
    event.field = note.field;
    event.expiration_date = note.expiration_date;
    event.date_sent = note.date_sent;
    event.note_number = note.number;
    emit(event);
}
