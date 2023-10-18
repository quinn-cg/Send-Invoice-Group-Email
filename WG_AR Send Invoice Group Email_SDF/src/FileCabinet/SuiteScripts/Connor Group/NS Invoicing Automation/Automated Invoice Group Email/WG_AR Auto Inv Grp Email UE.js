/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/compress', 'N/email', 'N/error', 'N/file', 'N/record', 'N/render', 'N/runtime', 'N/search', 'N/format/i18n', 'N/query'],
    /**
 * @param{compress} compress
 * @param{email} email
 * @param{error} error
 * @param{file} file
 * @param{record} record
 * @param{render} render
 * @param{runtime} runtime
 * @param{search} search
 * @param {formati} formati
 * @param {query} query
 */
    (compress, email, error, file, record, render, runtime, search, formati, query) => {

        /**
         * Defines the function definition that is executed after record is submitted.
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.type - Trigger type; use values from the context.UserEventType enum
         * @since 2015.2
         */
        const afterSubmit = (scriptContext) => {

            sendInvoiceGroupEmail(scriptContext.newRecord)

        }

        function sendInvoiceGroupEmail(newRecord) {

            const sendEmail = validateConditionsToSendGroupEmail(newRecord.id, newRecord.getValue({fieldId: 'customer'}))
    
            if (sendEmail) {
    
                log.audit('Invoice Group Email to Be Sent', 'Sending Invoice Group email for record id ' + newRecord.id)

                var groupedInvoiceIdArray = getGroupInvoiceInternalId(newRecord.id)
    
                var {emailSubject, emailBody} = retrieveInvoiceGroupEmailMessage(newRecord)

                const attachmentFiles = createAttachmentFiles(newRecord.id, groupedInvoiceIdArray)

                sendEmailWithAttachments(newRecord.getValue({fieldId: 'customer'}), emailSubject, emailBody, attachmentFiles, newRecord.id)

                log.audit('Invoice Group Email Sent', 'Invoice Group Email was sent for Invoice Group Id ' + newRecord.id)
    
            }
    
        }
    
        function validateConditionsToSendGroupEmail(recordId, customerId) {
    
            try {
    
                var sendEmail = false
    
                var columnsFields = [];
                columnsFields.push("custentity_cg_automated_inv_grp_email");
                columnsFields.push("custentity_wg_invoice_emails");
                var customerFields = search.lookupFields({
                    type: search.Type.CUSTOMER,
                    id: customerId,
                    columns: columnsFields
                });
    
                if (customerFields.custentity_wg_invoice_emails != null) {
    
                    sendEmail = true
    
                } 
    
                return sendEmail
    
            }
            catch(e) {
    
                const failToValidateInvoiceGroupEmail = error.create({
                    name: 'FAIL_VALIDATE_INV_GRP'
                    , message: 'Failed to validate if an email should be sent for inv group ID ' + recordId + ' for customer ID ' + customerId + '. Error message returned was . . . ' + e
                })
    
                log.audit(failToValidateInvoiceGroupEmail.name, failToValidateInvoiceGroupEmail.message)
    
            }
    
        }
    
        function getGroupInvoiceInternalId(recordId) {
    
            // Saved Search to Access Internal Ids

            try {

                var transactionSearchObj = search.create({
                    type: "transaction",
                    filters:
                    [
                       ["groupedto","anyof",recordId]
                    ],
                    columns:
                    [
                       search.createColumn({
                          name: "internalid",
                          summary: "GROUP",
                          label: "Internal ID"
                       })
                    ]
                 });
                 
                var searchResults = getSearchResults(transactionSearchObj, recordId)
    
                return searchResults

            }
            catch(e) {

                const errorHandling = error.create({
                    name: 'Error Creating Search Object'
                    , message: 'An error occured creating the search object to identify all associated invoices for group invoice id ' + recordId + '. Error returned was . . . ' + e
                })

                log.audit(errorHandling.name, errorHandling.message)

            }
    
        }
    
        function retrieveInvoiceGroupEmailMessage(rec) {
    
            try {
    
                // const invGrpEmailTemplateId = runtime.getCurrentScript().getParameter({
                //     name: 'custscript_inv_grp_email_temp'
                // })

                // var invGroupNumber = rec.getValue('invoicegroupnumber')
                // var customer = rec.getText('customer')
                // var currency = rec.getText('currency')
                // var dueDate = new Date(rec.getValue('duedate'))

                var relatedRecordsMachineLength = rec.getLineCount({
                    sublistId: 'relatedrecordmachine'
                })

                log.debug('rec', rec)

                log.debug('Related Records Length', relatedRecordsMachineLength)

                var queryResults = query.runSuiteQL({
                    query: `
                        SELECT
                            invoiceGroupNumber
                            , BUILTIN.DF(customer) customer
                            , NVL(amountDue, 0) amountdue
                            , BUILTIN.DF(currency) currency
                            , dueDate
                        FROM
                            invoiceGroup
                        WHERE
                            id = ?`
                    , params: [rec.id]
                }).asMappedResults()[0]

                var amtDue = rec.getValue('amountdue')

                log.debug('Amount Due', amtDue)

                // Format Currency Appropriately
                var formatter = formati.getCurrencyFormatter({
                    currency: queryResults.currency
                })
                var amtDueFormatted = formatter.format({
                    number: amtDue
                })

                var dueDate = new Date(queryResults.duedate)

                // Aggregate Variable for Date
                var day = dueDate.getDate()
                var month = dueDate.getMonth()
                var year = dueDate.getFullYear()

                var emailSubject = `WatchGuard Technologies Inc. Invoice #${queryResults.invoicegroupnumber}`

                var emailBody = 
                `Hi ${queryResults.customer},

                Please find your invoice ${queryResults.invoicegroupnumber}. The amount outstanding, ${amtDueFormatted} ${queryResults.currency}, is due on ${day}/${month}/${year}.

                Thank you for your Business,
                WatchGuard Team`
        
                return {emailSubject, emailBody}
    
            }
            catch(e) {
    
                const failToGenerateInvGrpEmlTemp = error.create({
                    name: 'FAIL_GEN_INV_GRP_TEMPLATE'
                    , message: 'Failed to access and generate the Invoice Email Group Email Template for invoice group ID ' + rec.id + '. Error message returned was . . . ' + e
                })
    
                log.audit(failToGenerateInvGrpEmlTemp.name, failToGenerateInvGrpEmlTemp.message)
    
            }
    
        }

        function createAttachmentFiles(recordId, groupedInvoiceIdArray) {

            try {

                var attachmentFiles = []

                /**
                 * Commented out on 10/16/2023
                 * > NS Support relayed it is expected that the Invoice Group PDFs will be unable to access related invoice detail and summary information when triggered via script.
                 * > Ref Case Num: 5286811
                 */
                // // Generate Invoice Group PDF
                // var invoiceGroupPDFID =  runtime.getCurrentScript().getParameter('custscript_inv_grp_adv_pdf')
                // var renderer = render.create();
                // renderer.setTemplateById(invoiceGroupPDFID)
                // renderer.addRecord('record', record.load({
                //     type: 'invoicegroup',
                //     id: recordId
                // }))
                // const invoiceGroupPDF = renderer.renderAsPdf()

                // attachmentFiles.push(invoiceGroupPDF);

                // Create ZIP File of all Invoice PDFs
                var archiver = compress.createArchiver()
                for (result in groupedInvoiceIdArray) {

                    const invoicePDF = render.transaction({
                        entityId: Number(groupedInvoiceIdArray[result].getValue({name: 'internalid', summary: 'GROUP'}))
                        , printMode: render.PrintMode.PDF
                    })
    
                    archiver.add({
                        file: invoicePDF
                    })
    
                }

                var zipFile = archiver.archive({
                    name: 'Related Invoice PDFs.zip'
                })
    
                attachmentFiles.push(zipFile)

                // Attach CSV Files
                const detailsSearchId = runtime.getCurrentScript().getParameter('custscript_inv_details_csv_search')

                var detailsSearch = search.load({
                    id: detailsSearchId
                })

                var defaultFilters = detailsSearch.filters

                defaultFilters.push(search.createFilter({
                    name: 'groupedto'
                    , operator: search.Operator.IS
                    , values: recordId.toString()
                }))

                log.debug('Default Filters for Search', defaultFilters)

                detailsSearch.filters = defaultFilters

                const invoiceDetailsCSV = createCSVFileFromSearch(detailsSearch, 'Invoice Details.csv')

                attachmentFiles.push(invoiceDetailsCSV)
    
                return attachmentFiles

            }
            catch(e) {

                const attachmentError = error.create({
                    name: 'ERROR_ATTACHING_FILES'
                    , message: 'An error occured creating attachment files for invoice group record id ' + recordId + '. Error message returned was ' + e
                })

                log.audit(attachmentError.name, attachmentError.message)

            }

        }

        function sendEmailWithAttachments(customerId, subject, body, attachmentFiles, recordId) {

            try {

                const author = runtime.getCurrentUser().id
                const recipients = search.lookupFields({
                    type: 'customer'
                    , id: customerId
                    , columns: ['custentity_wg_invoice_emails']
                }).custentity_wg_invoice_emails

                log.debug('Recipients', recipients)
    
                var emailObject = email.send({
                    author: author
                    , recipients: recipients
                    , subject: subject
                    , body: body
                    , attachments: attachmentFiles
                    , relatedRecords: {
                        customRecord: {
                            id: recordId
                            , recordType: 'invoiceGroup'
                        }
                    }
                })
    

            }
            catch(e) {

                const failToSendEmail = error.create({

                    name: 'FAIL_SEND_EMAIL'
                    , message: 'Failed to send automatic invoice group email for record id. Error message returned was . . . ' + e

                })

                log.audit(failToSendEmail.name, failToSendEmail.message)

            }
        }
    
        function getSearchResults(obj) {
            try {
                var resultSet = obj.run();
                var results = [];
                var searchResults = [];
                var start = 0;
                // get all results, even if there is more than the 1000 limit
                do {
                    results = resultSet.getRange({
                        start: start,
                        end: start + 1000
                    });
                    start += 1000;
                    searchResults = searchResults.concat(results);
                } while (results.length);
                return searchResults
            } catch (e) {
    
                const errorRunningSavedSearch = error.create({
                    name: 'ERROR_RUNNING_SEARCH'
                    , message: 'An error occured running a search to identify invoices related to the invoice group record id ' + recordId + '. Error returned was . . . ' + e.message
                })
                log.audit(errorRunningSavedSearch.name, errorRunningSavedSearch.message);
            }
        }

        function createCSVFileFromSearch(searchObj, fileName) {

            try {
                var csvData = ''

                var resultSet = searchObj.run()
                var myPagedData = searchObj.runPaged({ pageSize: 1000 });
                log.debug("Licens Product Search length", myPagedData.count);
                if (resultSet.columns)
                    for (var n = 0; n < resultSet.columns.length; n++) {
                        csvData += resultSet.columns[n].label;
                        if ((n + 1) < resultSet.columns.length)
                            csvData += ",";
                        else
                            csvData += "\r\n";
                    }
    
                    for (var i = 0; i < myPagedData.pageRanges.length; i++) {
                        var pageRange = myPagedData.pageRanges[i];
                        var currentPage = myPagedData.fetch({ index: pageRange.index });//5
                        for (var j = 0; j < currentPage.data.length; j++) {
                            try {
                                var result = currentPage.data[j];
                                for (var n = 0; n < resultSet.columns.length; n++) {
                                    // Encapsulated in the double quotes to ensure all returned values are aggregated together
                                    csvData += `"${result.getValue({ name: resultSet.columns[n] }).toString()}"`;
                                    if ((n + 1) < resultSet.columns.length)
                                        csvData += ",";
                                    else
                                        csvData += "\r\n";
                                }
                            }
                            catch (e) {
                                log.error("ProductName", e);
                            }
                        }
                    }
                
                var fileObj = file.create({
                    name: fileName,
                    fileType: file.Type.CSV,
                    contents: csvData
                });
                return fileObj;

            }
            catch(e) {

                const failGenerateCSV = error.create({
                    name: 'CSV_CREATION_FAIL'
                    , message: 'Failed to create a CSV from saved search for invoice group record. Error message returned was . . . ' + e
                })

                log.audit(failGenerateCSV.name, failGenerateCSV.message)

            }

        }

        return {afterSubmit}

    });
