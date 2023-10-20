/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 */
define(['N/compress', 'N/email', 'N/error', 'N/file', 'N/format/i18n', 'N/query', 'N/record', 'N/render', 'N/runtime', 'N/search'],
    /**
 * @param{compress} compress
 * @param{email} email
 * @param{error} error
 * @param{file} file
 * @param {formati} formati
 * @param{query} query
 * @param{record} record
 * @param{render} render
 * @param{runtime} runtime
 * @param{search} search
 */
    (compress, email, error, file, formati, query, record, render, runtime, search) => {
        /**
         * Defines the function that is executed at the beginning of the map/reduce process and generates the input data.
         * @param {Object} inputContext
         * @param {boolean} inputContext.isRestarted - Indicates whether the current invocation of this function is the first
         *     invocation (if true, the current invocation is not the first invocation and this function has been restarted)
         * @param {Object} inputContext.ObjectRef - Object that references the input data
         * @typedef {Object} ObjectRef
         * @property {string|number} ObjectRef.id - Internal ID of the record instance that contains the input data
         * @property {string} ObjectRef.type - Type of the record instance that contains the input data
         * @returns {Array|Object|Search|ObjectRef|File|Query} The input data to use in the map/reduce process
         * @since 2015.2
         */

        const getInputData = (inputContext) => {

            return {
                type: 'suiteql'
                , query: `
                    SELECT
                        id
                    FROM
                        invoicegroup
                    WHERE
                        NVL(custrecord_wg_inv_grp_email_sent, 'F') = 'F'`
                , params: []
            }

        }

        /**
         * Defines the function that is executed when the map entry point is triggered. This entry point is triggered automatically
         * when the associated getInputData stage is complete. This function is applied to each key-value pair in the provided
         * context.
         * @param {Object} mapContext - Data collection containing the key-value pairs to process in the map stage. This parameter
         *     is provided automatically based on the results of the getInputData stage.
         * @param {Iterator} mapContext.errors - Serialized errors that were thrown during previous attempts to execute the map
         *     function on the current key-value pair
         * @param {number} mapContext.executionNo - Number of times the map function has been executed on the current key-value
         *     pair
         * @param {boolean} mapContext.isRestarted - Indicates whether the current invocation of this function is the first
         *     invocation (if true, the current invocation is not the first invocation and this function has been restarted)
         * @param {string} mapContext.key - Key to be processed during the map stage
         * @param {string} mapContext.value - Value to be processed during the map stage
         * @since 2015.2
         */

        const map = (mapContext) => {

            log.debug('MapContext Value', mapContext.value)

            try {

                var invoiceGroupRecordId = JSON.parse(mapContext.value).values[0]

                log.debug('Invoice Group Record ID', invoiceGroupRecordId)

                var invoiceGroupRecord = record.load({
                    type: 'invoicegroup'
                    , id: invoiceGroupRecordId
                })

                var emailSent = sendInvoiceGroupEmail(invoiceGroupRecord)

                if (emailSent) {
                    invoiceGroupRecord.setValue({
                        fieldId: 'custrecord_wg_inv_grp_email_sent'
                        , value: emailSent
                    })

                    invoiceGroupRecord.save()
                }
            }
            catch(e) {

                log.error('Error During Map Stage', `An error occured during map stage for Invoice Group Record Id ${JSON.parse(mapContext.value).values[0]}. Error returned was . . . ${e}`)

            }

        }

        /**
         * Defines the function that is executed when the summarize entry point is triggered. This entry point is triggered
         * automatically when the associated reduce stage is complete. This function is applied to the entire result set.
         * @param {Object} summaryContext - Statistics about the execution of a map/reduce script
         * @param {number} summaryContext.concurrency - Maximum concurrency number when executing parallel tasks for the map/reduce
         *     script
         * @param {Date} summaryContext.dateCreated - The date and time when the map/reduce script began running
         * @param {boolean} summaryContext.isRestarted - Indicates whether the current invocation of this function is the first
         *     invocation (if true, the current invocation is not the first invocation and this function has been restarted)
         * @param {Iterator} summaryContext.output - Serialized keys and values that were saved as output during the reduce stage
         * @param {number} summaryContext.seconds - Total seconds elapsed when running the map/reduce script
         * @param {number} summaryContext.usage - Total number of governance usage units consumed when running the map/reduce
         *     script
         * @param {number} summaryContext.yields - Total number of yields when running the map/reduce script
         * @param {Object} summaryContext.inputSummary - Statistics about the input stage
         * @param {Object} summaryContext.mapSummary - Statistics about the map stage
         * @param {Object} summaryContext.reduceSummary - Statistics about the reduce stage
         * @since 2015.2
         */
        const summarize = (summaryContext) => {

            log.audit('summaryContext', summaryContext)

        }

        return {getInputData, map, summarize}

        function sendInvoiceGroupEmail(newRecord) {

            try {

                var emailSent = false

                const sendEmail = validateConditionsToSendGroupEmail(newRecord.id, newRecord.getValue({fieldId: 'customer'}))
        
                if (sendEmail) {
        
                    log.audit('Invoice Group Email to Be Sent', 'Sending Invoice Group email for record id ' + newRecord.id)
    
                    var groupedInvoiceIdArray = getGroupInvoiceInternalId(newRecord.id)
        
                    var {emailSubject, emailBody} = retrieveInvoiceGroupEmailMessage(newRecord)
    
                    const attachmentFiles = createAttachmentFiles(newRecord.id, groupedInvoiceIdArray)
    
                    emailSent = sendEmailWithAttachments(newRecord.getValue({fieldId: 'customer'}), emailSubject, emailBody, attachmentFiles, newRecord.id)
    
                    log.audit('Invoice Group Email Sent', 'Invoice Group Email was sent for Invoice Group Id ' + newRecord.id)
        
                }
    
                return emailSent

            }
            catch(e) {
                log.error('Error during Send Invoice Group Email', `An error occured during the Send Invoice Group Email process for group invoice id ${newRecord.id}. Error returned was . . . ${e}`)
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
                else{

                    log.error(`Customer Invoice Emails Not Populated`, `Customer with ID ${customerId} does not have Inovice Emails populated.`)

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

                // Retrieve Data from Record
                var queryResults = query.runSuiteQL({
                    query: `
                        SELECT
                            ig.invoiceGroupNumber
                            , BUILTIN.DF(ig.customer) customer
                            , NVL(ig.amountDue, 0) amountdue
                            , BUILTIN.DF(ig.currency) currency
                            , ig.dueDate
                            , ig.tranDate
                            , s.name subsidiary
                        FROM
                            invoiceGroup ig
                            JOIN subsidiary s ON ig.subsidiary = s.id
                        WHERE
                            ig.id = ?`
                    , params: [rec.id]
                }).asMappedResults()[0]

                // Format Currency Appropriately
                var formatter = formati.getCurrencyFormatter({
                    currency: queryResults.currency
                })
                var amtDueFormatted = formatter.format({
                    number: queryResults.amountdue
                })

                var dueDate = new Date(queryResults.duedate)

                // Aggregate Variable for Date
                var day = dueDate.getDate()
                var month = dueDate.getMonth() + 1 // increase by one since months start with base 0
                var year = dueDate.getFullYear()

                var emailSubject = `WatchGuard Invoice #${queryResults.invoicegroupnumber} for ${queryResults.customer} - ${queryResults.trandate}`

                var emailBody =  `<span style="font-size:12pt"><span style="text-autospace:none"><span style="font-family:"Times New Roman",serif"><span style="font-size:10.0pt"><span style="font-family:"Arial",sans-serif">Hello,</span></span></span></span></span><br />
               <br />
               <span style="font-size:12pt"><span style="text-autospace:none"><span style="font-family:"Times New Roman",serif"><span style="font-size:10.0pt"><span style="font-family:"Arial",sans-serif">Attached you’ll find a PDF file containing your </span></span></span></span></span>${queryResults.subsidiary} invoice group <strong>${queryResults.invoicegroupnumber}</strong>. The amount outstanding, ${amtDueFormatted} ${queryResults.currency}, is due on ${queryResults.duedate}.<br />
               <br />
               <span style="font-size:12pt"><span style="font-family:"Times New Roman",serif"><b><span style="font-size:10.0pt"><span style="font-family:"Arial",sans-serif"><span style="color:red">Note</span></span></span></b><span style="font-size:10.0pt"><span style="font-family:"Arial",sans-serif">: Please confirm receipt of this email by responding with the word “received” in the subject line.  This is unnecessary if your account will automatically reply once you have read this email.</span></span></span></span><br />
               <br />
               <span style="font-size:12pt"><span style="font-family:"Times New Roman",serif"><span style="font-size:10.0pt"><span style="font-family:"Arial",sans-serif">Thank you and have a good day.</span></span></span></span><br />
               <br />
               <span style="font-size:12pt"><span style="font-family:"Times New Roman",serif"><b><span style="font-size:8.0pt"><span style="font-family:"Verdana",sans-serif">Best Regards,</span></span></b></span></span><br />
               <br />
               <br />
               <span style="font-size:12pt"><span style="font-family:"Times New Roman",serif"><b><span style="font-size:9.0pt"><span style="font-family:"Arial",sans-serif"><span style="color:black">WatchGuard Billing Team</span></span></span></b><br />
               <span style="font-size:9.0pt"><span style="font-family:"Arial",sans-serif"><span style="color:gray">WatchGuard Technologies, Inc. |</span></span></span><span style="font-size:9.0pt"><span style="font-family:"Arial",sans-serif"><span style="color:black"> <a href="http://www.watchguard.com/" style="color:blue; text-decoration:underline"><span style="color:gray">www.watchguard.com</span></a> </span></span></span></span></span><br />
               <br />
               <span style="font-size:12pt"><span style="font-family:"Times New Roman",serif"><span style="font-size:9.0pt"><span style="font-family:"Arial",sans-serif"><span style="color:gray"><a href="mailto:AccountsReceivable@watchguard.com" style="color:blue; text-decoration:underline">AccountsReceivable@watchguard.com</a></span></span></span></span></span><br />
               <span style="font-size:12pt"><span style="font-family:"Times New Roman",serif"><span style="font-size:8.0pt"><span style="font-family:"Verdana",sans-serif"><span style="color:gray"><span style="letter-spacing:.2pt">206.613.6600 Corporate Headquarters</span></span></span></span><br />
               <br />
               <span style="font-size:8.0pt"><span style="font-family:"Courier New""><span style="color:gray"><span style="letter-spacing:.2pt">. . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .</span></span></span></span><br />
               <b><span style="font-size:8.0pt"><span style="font-family:"Verdana",sans-serif"><span style="letter-spacing:.2pt">Get Red. Get Secu<span style="color:red">red</span>.</span></span></span></b></span></span>`
        
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
                const detailsSearchId = runtime.getCurrentScript().getParameter('custscript_inv_details_search')

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

            var emailSent = false

            try {

                const author = 4686// Internal Id of WG Orders Employee
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

                emailSent = true
    

            }
            catch(e) {

                const failToSendEmail = error.create({

                    name: 'FAIL_SEND_EMAIL'
                    , message: 'Failed to send automatic invoice group email for record id. Error message returned was . . . ' + e

                })

                log.audit(failToSendEmail.name, failToSendEmail.message)

            }

            return emailSent
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

                var pageSize = 1000
                var pagedSearchObj = searchObj.runPaged({ pageSize: pageSize });
                log.debug("Search Length", pagedSearchObj.count);
                if (searchObj.columns)
                    for (var column of searchObj.columns) {
                        csvData += `"${column.label}"`;
                        
                        if (column == searchObj.columns[searchObj.columns.length - 1]) {
                            csvData+='\r\n'
                        }
                        else {
                            csvData+=','
                        }

                    }
    
                    var numPages = Math.ceil(pagedSearchObj.count / pageSize)

                    for (var i = 0; i < numPages; i++) {
                        pagedSearchObj.fetch({ index: i }).data.forEach(function (result) {

                            for (var j in result.columns) {

                                var columnValue = result.getText({
                                    name: result.columns[j].name
                                    , join: result.columns[j].join
                                    , summary: result.columns[j].summary
                                    , func: result.columns[j].function
                                })

                                if (columnValue == null) {

                                    var columnValue = result.getValue({
                                        name: result.columns[j].name
                                        , join: result.columns[j].join
                                        , summary: result.columns[j].summary
                                        , func: result.columns[j].function
                                    })

                                }

                                csvData += `"${columnValue}"`

                                if (j == (result.columns.length-1)) {
                                    csvData+='\r\n'
                                }
                                else {
                                    csvData+=','
                                }

                            }

                        });

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

    });
