// services/ishareService.js
const axios = require('axios');

class IShareService {
  constructor() {
    this.endpoint = process.env.ISHARE_ENDPOINT || 'http://41.215.168.146:443/FlexiShareBundles.asmx';
    this.username = process.env.ISHARE_USERNAME || 'NetwiseSolutions';
    this.password = process.env.ISHARE_PASSWORD || 'f2fe6a63d960578490f3097d9447fcd0';
    this.dealerMsisdn = process.env.ISHARE_DEALER_MSISDN || '233270241113';
  }

  // Check balance on the dealer MSISDN
  async checkBalance() {
    const soapRequest = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <tem:FlexiShareBalanceCheck>
      <tem:username>${this.username}</tem:username>
      <tem:password>${this.password}</tem:password>
      <tem:dealerMsisdn>${this.dealerMsisdn}</tem:dealerMsisdn>
    </tem:FlexiShareBalanceCheck>
  </soapenv:Body>
</soapenv:Envelope>`;

    try {
      const response = await axios.post(this.endpoint, soapRequest, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://tempuri.org/FlexiShareBalanceCheck'
        },
        timeout: 30000 // 30 seconds timeout
      });

      return this.parseBalanceResponse(response.data);
    } catch (error) {
      console.error('iShare Balance Check Error:', error.message);
      throw new Error('Failed to check iShare balance from provider');
    }
  }

  // Send iShare transfer
  async sendTransfer(recipientMsisdn, amountMB, transactionId) {
    // Validate minimum amount (API requires 50MB minimum)
    if (amountMB < 50) {
      throw new Error('Minimum transfer amount is 50MB');
    }

    // Format recipient number to international format (12 digits)
    const formattedRecipient = this.formatMsisdn(recipientMsisdn);

    const soapRequest = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <tem:FlexiIshareBundle>
      <tem:username>${this.username}</tem:username>
      <tem:password>${this.password}</tem:password>
      <tem:dealerMsisdn>${this.dealerMsisdn}</tem:dealerMsisdn>
      <tem:recipientMsisdn>${formattedRecipient}</tem:recipientMsisdn>
      <tem:transactionId>${transactionId}</tem:transactionId>
      <tem:sharedBundle>${amountMB}</tem:sharedBundle>
    </tem:FlexiIshareBundle>
  </soapenv:Body>
</soapenv:Envelope>`;

    try {
      console.log('Sending SOAP request with formatted recipient:', formattedRecipient);
      
      const response = await axios.post(this.endpoint, soapRequest, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://tempuri.org/FlexiIshareBundle'
        },
        timeout: 60000 // 60 seconds timeout for transfers
      });

      return this.parseTransferResponse(response.data);
    } catch (error) {
      console.error('iShare Transfer Error:', error.message);
      throw new Error('Failed to send iShare transfer to provider');
    }
  }

  // Check transaction status
  async checkTransactionStatus(transactionId) {
    const soapRequest = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
  <soapenv:Header/>
  <soapenv:Body>
    <tem:FlexiIshareTranxStatus>
      <tem:username>${this.username}</tem:username>
      <tem:password>${this.password}</tem:password>
      <tem:transactionId>${transactionId}</tem:transactionId>
    </tem:FlexiIshareTranxStatus>
  </soapenv:Body>
</soapenv:Envelope>`;

    try {
      const response = await axios.post(this.endpoint, soapRequest, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://tempuri.org/FlexiIshareTranxStatus'
        },
        timeout: 30000 // 30 seconds timeout
      });

      return this.parseTransactionStatusResponse(response.data);
    } catch (error) {
      console.error('iShare Transaction Status Error:', error.message);
      throw new Error('Failed to check transaction status');
    }
  }

  // Parse balance check response
  parseBalanceResponse(xmlResponse) {
    try {
      // Extract response code and message
      const responseCodeMatch = xmlResponse.match(/<ResponseCode>(\d+)<\/ResponseCode>/);
      const responseMsgMatch = xmlResponse.match(/<ResponseMsg>(.*?)<\/ResponseMsg>/);
      const dataBalanceMatch = xmlResponse.match(/<DataBalance>(\d+)<\/DataBalance>/);
      const expireTimeMatch = xmlResponse.match(/<ExpireTime>(.*?)<\/ExpireTime>/);

      const responseCode = responseCodeMatch ? responseCodeMatch[1] : null;
      const responseMsg = responseMsgMatch ? responseMsgMatch[1] : null;
      const dataBalance = dataBalanceMatch ? parseInt(dataBalanceMatch[1]) : 0;
      const expireTime = expireTimeMatch ? expireTimeMatch[1] : null;

      return {
        success: responseCode === '200',
        responseCode,
        message: responseMsg,
        balance: dataBalance,
        balanceInGB: (dataBalance / 1024).toFixed(2),
        expireTime
      };
    } catch (error) {
      console.error('Error parsing balance response:', error);
      throw new Error('Failed to parse balance response');
    }
  }

  // Parse transfer response
  parseTransferResponse(xmlResponse) {
    try {
      const responseCodeMatch = xmlResponse.match(/<ResponseCode>(\d+)<\/ResponseCode>/);
      const responseMsgMatch = xmlResponse.match(/<ResponseMsg>(.*?)<\/ResponseMsg>/);
      const systemTranxMatch = xmlResponse.match(/<systemTranx_id>(.*?)<\/systemTranx_id>/);
      const vendorTranxMatch = xmlResponse.match(/<vendorTranx_id>(.*?)<\/vendorTranx_id>/);

      const responseCode = responseCodeMatch ? responseCodeMatch[1] : null;
      const responseMsg = responseMsgMatch ? responseMsgMatch[1] : null;
      const systemTranxId = systemTranxMatch ? systemTranxMatch[1] : null;
      const vendorTranxId = vendorTranxMatch ? vendorTranxMatch[1] : null;

      return {
        success: responseCode === '200',
        responseCode,
        message: responseMsg,
        systemTransactionId: systemTranxId,
        vendorTransactionId: vendorTranxId
      };
    } catch (error) {
      console.error('Error parsing transfer response:', error);
      throw new Error('Failed to parse transfer response');
    }
  }

  // Parse transaction status response
  parseTransactionStatusResponse(xmlResponse) {
    try {
      const responseMsgMatch = xmlResponse.match(/<ResponseMsg>(.*?)<\/ResponseMsg>/);
      const sharedBundleMatch = xmlResponse.match(/<SharedBundle>(\d+)<\/SharedBundle>/);
      const vendorTranxMatch = xmlResponse.match(/<VendorTranxId>(.*?)<\/VendorTranxId>/);
      const systemTranxMatch = xmlResponse.match(/<SystemTranxId>(.*?)<\/SystemTranxId>/);
      const senderMsisdnMatch = xmlResponse.match(/<SenderMsisdn>(.*?)<\/SenderMsisdn>/);
      const recipientMsisdnMatch = xmlResponse.match(/<RecipientMsisdn>(.*?)<\/RecipientMsisdn>/);

      return {
        message: responseMsgMatch ? responseMsgMatch[1] : null,
        sharedBundle: sharedBundleMatch ? parseInt(sharedBundleMatch[1]) : 0,
        vendorTransactionId: vendorTranxMatch ? vendorTranxMatch[1] : null,
        systemTransactionId: systemTranxMatch ? systemTranxMatch[1] : null,
        senderMsisdn: senderMsisdnMatch ? senderMsisdnMatch[1] : null,
        recipientMsisdn: recipientMsisdnMatch ? recipientMsisdnMatch[1] : null
      };
    } catch (error) {
      console.error('Error parsing transaction status response:', error);
      throw new Error('Failed to parse transaction status response');
    }
  }

  // UPDATED: Format phone number to international format (12 digits)
  formatMsisdn(phoneNumber) {
    // Add debugging to see what we're receiving
    console.log('Original phoneNumber received:', phoneNumber, 'Type:', typeof phoneNumber);
    
    // Handle null, undefined, or empty values
    if (!phoneNumber) {
      throw new Error('Phone number is required');
    }
    
    // Convert to string if it's not already
    const phoneStr = String(phoneNumber).trim();
    console.log('Phone number as string:', phoneStr);
    
    // Remove any non-digit characters (spaces, dashes, parentheses, etc.)
    let cleaned = phoneStr.replace(/\D/g, '');
    console.log('Cleaned phone number:', cleaned);
    
    // Handle different input formats
    if (cleaned.length === 10 && cleaned.startsWith('0')) {
      // Ghana local format with leading 0 (e.g., 0267781294)
      // Remove the leading 0 and add country code 233
      cleaned = '233' + cleaned.substring(1);
      console.log('Processed 10-digit number with leading 0:', cleaned);
    } else if (cleaned.length === 10 && !cleaned.startsWith('0')) {
      // Ghana local format without leading 0 (e.g., 267781294)
      // Add country code 233
      cleaned = '233' + cleaned;
      console.log('Processed 10-digit number without leading 0:', cleaned);
    } else if (cleaned.length === 9) {
      // Ghana local format without leading 0 (e.g., 67781294 - missing first digit)
      // Add country code 233 and assume missing 2
      cleaned = '233' + '2' + cleaned;
      console.log('Processed 9-digit number (assumed missing 2):', cleaned);
    } else if (cleaned.length === 12) {
      // Already in international format
      // Verify it starts with 233 for Ghana
      if (!cleaned.startsWith('233')) {
        throw new Error('International format must start with Ghana country code 233');
      }
      console.log('Already in international format:', cleaned);
    } else if (cleaned.length === 13 && cleaned.startsWith('0233')) {
      // Handle format like 0233XXXXXXXXX (remove leading 0)
      cleaned = cleaned.substring(1);
      console.log('Processed 13-digit number with leading 0233:', cleaned);
    } else {
      throw new Error(`Invalid phone number format. Received ${cleaned.length} digits: "${cleaned}". Expected formats: 0XXXXXXXXX (10 digits), XXXXXXXXX (9 digits), or 233XXXXXXXXX (12 digits)`);
    }
    
    // Final validation - must be exactly 12 digits
    if (cleaned.length !== 12) {
      throw new Error(`Final formatted number must be 12 digits. Got ${cleaned.length} digits: "${cleaned}"`);
    }
    
    // Validate Ghana mobile number format (233 + valid Ghana mobile prefix)
    const validPrefixes = ['23320', '23324', '23325', '23326', '23327', '23328', '23350', '23354', '23355', '23356', '23357', '23359'];
    const prefix = cleaned.substring(0, 5);
    
    if (!validPrefixes.includes(prefix)) {
      console.warn(`Warning: Phone number ${cleaned} may not be a valid Ghana mobile number. Prefix: ${prefix}`);
      // Continue anyway as API might accept other formats
    }
    
    console.log('Final formatted number:', cleaned);
    return cleaned;
  }

  // Generate unique transaction ID
  generateTransactionId(prefix = 'ISHARE') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}_${timestamp}_${random}`;
  }

  // Get error message from error code
  getErrorMessage(errorCode) {
    const errorCodes = {
      '200': 'Successfully queried; good feedback',
      '319': 'No balance',
      '306': 'Subscriber does not exist',
      '161': 'Incorrect RecipientMsisdn. Must be in numbers (12 digit international format MSISDN)',
      '165': 'Incorrect Recipient MSISDN Length',
      '305': 'Invalid Username/Password',
      '312': 'Sorry, you are not eligible to buy this product. Kindly call 0577555000 or email business@airteltigo.com.gh to subscribe!!',
      '61319': 'Sorry the process failed. Please try again',
      '64528': 'Recharge will increase balance beyond max threshold'
    };

    return errorCodes[errorCode] || `Unknown error code: ${errorCode}`;
  }

  // Validate phone number format before processing
  validatePhoneNumber(phoneNumber) {
    if (!phoneNumber) {
      return { valid: false, error: 'Phone number is required' };
    }

    const phoneStr = String(phoneNumber).trim();
    const cleaned = phoneStr.replace(/\D/g, '');

    if (cleaned.length === 10) {
      return { valid: true, cleaned: cleaned };
    } else if (cleaned.length === 12 && cleaned.startsWith('233')) {
      return { valid: true, cleaned: cleaned.substring(3) }; // Return 10-digit local format
    } else {
      return { 
        valid: false, 
        error: `Invalid phone number format. Expected 10 digits, got ${cleaned.length}`,
        received: cleaned
      };
    }
  }
}

module.exports = new IShareService();