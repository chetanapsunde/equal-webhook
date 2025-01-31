import * as types from '../utils/types.js';
import { logger } from '../utils/logging.js';
import { extractTextFromDocument, deleteFile } from '../utils/readFileData.js';
import { markAsRead, sendWatsAppText, sendWatsAppReplyText, getWAMediaURL, downloadWAFile, sendWatsAppWithButtons, sendWatsAppWithList, sendWhatsAppFileLink, sendWatsAppVideo, sendWhatsAppOrderForPayment, sendWhatsAppOrderStatus } from '../whatsApp/whatsAppAPI.js';
import { interactWithAssistant, createAssistantThread } from "../chatGPT/helpers/assistant-api.js";
import { deleteSession, getSession, saveSession, updateSessionWithNewThread, updateSessionWithPayment } from '../Services/redis/redisWASession.js';
import { getActionFromDFES } from '../Services/Dialogflow/detectIntentES.js';
import { getCXEventResponse, getCXResponse } from '../Services/Dialogflow/detectIntentCX.js';
import { DFchipsToButtonOrList } from '../whatsApp/DFchipsToButtons.js';
import { convertMarkdownToWhatsApp } from '../whatsApp/markdownToWA.js';
import { generateId } from '../utils/generateID.js';

const handleInteractiveButtons = async (message, from, phone_number_id) => {
    switch (message.interactive.type) {
        case 'button_reply':
            message.text = { "body": message.interactive.button_reply.id };
            break;
        case 'list_reply':
            message.text = { "body": message.interactive.list_reply.description };
            break;
        case 'payment':
            if (message.interactive.payment.status == 'success')
                sendWhatsAppOrderStatus('Payment Received', message.interactive.payment.reference_id, 'processing', 'Access requested for next 2 hours', from, phone_number_id);
            return;
        default:
            return;
    }

    handleTextMessage(message, from, phone_number_id);
}
const handleTextMessage = async (message, from, phone_number_id) => {

    let response = {
        answer: 'Please reply from one of the options. Reply \'Reset\' to change your answers in between the conversation.'
    }
    let options = {
        button: "Options",
        sections: [
            {
                title: "Financial Frauds",
                rows: [
                    {
                        "id": "ATM",
                        "title": "ATM Frauds",
                        "description": "Frauds using your ATM cards"
                    },
                    {
                        "id": "UPI",
                        "title": "UPI Fraud",
                        "description": "Frauds using your bank UPI account"
                    },
                    {
                        "id": "Failures",
                        "title": "Payment failures",
                        "description": "Issues related to payment failures"
                    },
                    {
                        "id": "ATM Failures",
                        "title": "ATM Transaction failed",
                        "description": "Cash not dispensed"
                    }
                ]
            },
            {
                title: "Employment",
                rows: [
                    {
                        "id": "Employment Termination",
                        "title": "Employee",
                        "description": "Employment Termination Issues"
                    },
                    {
                        "id": "Employment OfferLetter",
                        "title": "Offer Letter",
                        "description": "Analyze Employment Offer Letter"
                    },
                    {
                        "id": "Employment Payment",
                        "title": "Salary Issues",
                        "description": "Delay or Non Payments of Salary & Statutory Benefits"
                    }
                ]
            },
            {
                title: "Travel",
                rows: [
                    {
                        "id": "Flights",
                        "title": "Flights Grievances",
                        "description": "Issues while Traveling in Flight"
                    },
                    {
                        "id": "Trains",
                        "title": "Trains Grievances",
                        "description": "Issues while Traveling in Train"
                    }
                ]
            }
        ]
    }

    let session, threadId;
    if (message.text.body.toLowerCase() == 'exit') {
        session = await deleteSession(from);
        if (session && session.payment && session.payment.reference_id)
            sendWhatsAppOrderStatus('EqualJustice.ai', session.payment.reference_id, 'completed', 'Access removed', from, phone_number_id);
        sendWatsAppWithList(response.answer, options, 'EqualJustice.ai', 'Reply \'Exit\' to start new case.', from, phone_number_id);
        return;
    }
    session = await getSession(from);
    if (!session) {
        let DFResponse = await getActionFromDFES(message.text.body, from);//call dialogflow ES detectIntent to get action
        if (DFResponse.fulfillmentText) {
            sendWatsAppText(DFResponse.fulfillmentText, from, phone_number_id);
        }
        if (DFResponse.payload && DFResponse.payload.action && DFResponse.payload.agentType) {
            if (DFResponse.payload.agentType == 'assistant') {
                threadId = await createAssistantThread(from);
            }
            else {
                threadId = 'whatsApp-' + from + '-' + await generateId(8)
            }
            session = {
                threadId: threadId,
                action: DFResponse.payload.action,
                agentType: DFResponse.payload.agentType,
                targetAgent: DFResponse.payload.targetAgent,
                payment: { transaction: { status: 'pending' }, linkSent: false },
                interactions: 1
            }
            message.text = { "body": "hi" }
            saveSession(from, threadId, DFResponse.payload.action, DFResponse.payload.agentType, DFResponse.payload.targetAgent, session.payment, session.interactions);
            // if (DFResponse.payload.pricing && session.agentType == 'assistant') {
            //     let reference_id = await generateId(8);
            //     sendWhatsAppOrderForPayment("Please pay to proceed", DFResponse.payload.pricing, reference_id, from, phone_number_id);
            //     return;
            // }
            //session.payment = { transaction: { status: 'success' } }
            //updateSessionWithPayment(from, session.payment); 
        }
        else if (DFResponse.payload && DFResponse.payload.action) {
            session = {
                action: DFResponse.payload.action
            }
        }
        else {
            sendWatsAppWithList(response.answer, options, 'How can I help you Today?', 'EqualJustice.ai', from, phone_number_id);
            return;
        }
    }
    if (['restart', 'reset'].includes(message.text.body.toLowerCase())) {
        if (session.agentType == 'assistant') {
            session.threadId = await createAssistantThread(from);
        }
        else {
            session.threadId = 'whatsApp-' + from + '-' + await generateId(8)
        }
        updateSessionWithNewThread(from, session.threadId);
        message.text = { "body": "hi" }
    }
    switch (session.action) {
        case types.transaction.ATM:
        case types.transaction.UPI:
        case types.transaction.FAILED_TRANSACTION:
        case types.employee.Retrenchment:
        case types.travel.Flights:
        case types.employee.Offer:
            if ((session && session.targetAgent)) {
                if (session.agentType == 'assistant') {
                    if(session.interactions <= 10 || session.payment.transaction.status == 'success' || phone_number_id == '359476970593209'){
                        response = await interactWithAssistant(message.text.body, from, session.targetAgent.assistantId, session.threadId);
                        if (response.answer && response.answer != '')
                            response.answer = convertMarkdownToWhatsApp(response.answer);
                        // let DFResponse = await getActionFromDFES(message.text.body, from);
                        session.interactions++;
                        saveSession(from, session.threadId, session.action,session.agentType, session.targetAgent, session.payment, session.interactions);
                    }
                    else if ((session.interactions > 10 && session.payment && session.payment.transaction.status == 'pending') || phone_number_id == '359476970593209')//payment found in redis session
                    {
                        if (!session.payment.linkSent){
                            let reference_id = await generateId(8);
                            // let DFResponse = await getActionFromDFES(message.text.body, from);
                            sendWhatsAppOrderForPayment("Please pay to proceed", session.pricing, reference_id, from, phone_number_id);
                            session.payment.linkSent = true;
                            session.interactions++;
                            saveSession(from, session.threadId, session.action, session.agentType, session.targetAgent, session.payment, session.interactions);
                            return;
                        } else {
                            response = {
                                answer: `Please complete the payment to proceed further. If you have successfully paid, please wait.`
                            };
                        }
                    }
                    else if (session.payment) {
                        response = {
                            answer: `Please complete payment to proceed further. If you have successfully paid, Please wait.`
                        }
                    }
                }
                else
                    response = await getCXResponse(message.text.body, session.targetAgent, session.threadId, 'en');
            }

            else {
                response = {
                    answer: `Please send \'Exit\' to start again`
                }
            }
            break;
        case types.actions.Welcome:
            sendWatsAppWithList(response.answer, options, 'EqualJustice.ai', 'Reply \'Exit\' to start new case.', from, phone_number_id);
            sendWatsAppVideo(from, phone_number_id);
            return;
        case types.actions.Fallback:
            sendWatsAppWithList(response.answer, options, 'EqualJustice.ai', 'Reply \'Exit\' to start new case.', from, phone_number_id);
            return;
        default:
            response = {
                answer: `AI Training for this is under development, This service will be available soon.`
            }
    }
    sendAIResponse(session, response, message, from, phone_number_id);

};

const sendAIResponse = async (session, response, message, from, phone_number_id) => {
    if (response.payload && response.answer) {
        if (response.payload.pricing) {
            let reference_id = await generateId(8);
            sendWhatsAppOrderForPayment(response.answer, response.payload.pricing, reference_id, from, phone_number_id);
            return;
        }
        let options = DFchipsToButtonOrList(response.payload);
        //console.log("options from DFCX", JSON.stringify(options));
        // logger.info(`WhatsApp Reply ${from} :: ${message.text.body} :: Response:: ${response.answer}`);
        if (options.button)
            sendWatsAppWithList(response.answer, options, '', '', from, phone_number_id);
        else if (Array.isArray(options) && options.length > 0 && options.filter(option => option.type === 'reply'))
            sendWatsAppWithButtons(response.answer, options, '', from, phone_number_id);
        else if (options.name && options.name == 'cta_url') {
            sendWatsAppText(response.answer, from, phone_number_id);
            const fileSent = await sendWhatsAppFileLink('Here is link to download your document', options, 'Download Draft', 'EqualJustice.ai', from, phone_number_id);
            if (fileSent) {
                response = await getCXEventResponse('startQnA', session.targetAgent, session.threadId, 'en');
                sendAIResponse(session, response, message, from, phone_number_id);
            }
        }
        else
            sendWatsAppText(response.answer, from, phone_number_id);
    }
    else if (response.answer && response.answer != '') {
        if (message) {
            sendWatsAppReplyText(response.answer, message.id, from, phone_number_id);
        }
        else
            sendWatsAppText(response.answer, from, phone_number_id);
    }
    if (response.sessionEnd) {
        session = await deleteSession(from);
        if (session && session.payment && session.payment.reference_id)
            sendWhatsAppOrderStatus('EqualJustice.ai', session.payment.reference_id, 'completed', 'Access removed', from, phone_number_id);

    }
}

const handleDocumentMessage = async (message, from, phone_number_id) => {

    let media = await getWAMediaURL(message.document.id, phone_number_id);
    sendWatsAppText('We have received your document, Please wait while we are processing it.', from, phone_number_id);
    let filePath = await downloadWAFile(media.url, message.document.id + '_' + message.document.filename);
    logger.info(filePath);
    let pdfContent = await extractTextFromDocument(filePath, media.mime_type);
    message.text = { "body": pdfContent };
    handleTextMessage(message, from, phone_number_id);
    deleteFile(filePath);
};

const AnalyzeMessage = async (req, res) => {
    try {
        let message = req.body.entry[0].changes[0].value.messages[0];
        let phone_number_id = req.body.entry[0].changes[0].value.metadata.phone_number_id;
        markAsRead(message.id, phone_number_id);
        switch (message.type) {
            case 'text':
                await handleTextMessage(message, message.from, phone_number_id);
                break;
            case 'document':
                await handleDocumentMessage(message, message.from, phone_number_id);
                break;
            case 'interactive':
                await handleInteractiveButtons(message, message.from, phone_number_id);
                break;
            case 'image':
            case 'audio':
                break;
            case 'video':
                let media = await getWAMediaURL(message.video.id, phone_number_id);
                logger.info(JSON.stringify(media));
                //sendWatsAppReplyText("Received your media.", message.from);
                break;
            case 'reaction':
                break;
            default:
                //logger.info(JSON.stringify(req.body));
                //sendWatsAppReplyText("Unsupported message type.", message.from);
                break;
        }


    } catch (error) {
        logger.error(error);

    }
};

export const getWhatsAppMsg = async (req, res) => {
    //logger.info(JSON.stringify(req.body));
    if (isStatusMessage(req.body)) {
        let status = req.body.entry[0].changes[0].value.statuses[0]
        if (status.type == 'payment') {
            await updateSessionWithPayment(status.recipient_id, status.payment);
            if (status.status == 'captured') {
                handelPaymentStatus(req, res);
            }
            logger.info(JSON.stringify(status));
            //sendWhatsAppOrderStatus('Payment pending', status.payment.reference_id, status.status,status.recipient_id, phone_number_id)
        }

        res.sendStatus(200);
    }
    else if (hasMessagesArray(req.body)) {

        AnalyzeMessage(req, res);
        res.sendStatus(200);
    }
    else {
        res.sendStatus(200);
    }
};

const handelPaymentStatus = async (req, res) => {
    /* let Hibutton = [
                        {
                            type: "reply",
                            reply: {
                                id: 'Hi',
                                title: 'Hi'
                            }
                        }
                    ] */
    //sendWatsAppWithButtons('We have received your payment, please say Hi to continue.', Hibutton, '', status.recipient_id, phone_number_id);
    let status = req.body.entry[0].changes[0].value.statuses[0];
    let phone_number_id = req.body.entry[0].changes[0].value.metadata.phone_number_id;

    sendWhatsAppOrderStatus('Access allowed for next 2 hours, Say Hi to continue', status.payment.reference_id, 'completed', 'Payment Received', status.recipient_id, phone_number_id);

    let session = await getSession(status.recipient_id);
    if (session && session.agentType == 'CX') {
        let response = await getCXEventResponse('payment-captured', session.targetAgent, session.threadId, 'en');
        sendAIResponse(session, response, null, status.recipient_id, phone_number_id);
    }
    else {
        let message = { "text": { "body": 'Hi' } };
        handleTextMessage(message, status.recipient_id, phone_number_id);
    }
}

export const verifywhatsapp = async (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === 'equaljusticeai') {
        res.send(req.query['hub.challenge']);
    }
}
function hasMessagesArray(data) {
    return data.entry && data.entry[0].changes && data.entry[0].changes[0].value && Array.isArray(data.entry[0].changes[0].value.messages);
}
function isStatusMessage(data) {
    return data.entry && data.entry[0].changes && data.entry[0].changes[0].value && Array.isArray(data.entry[0].changes[0].value.statuses);
}
