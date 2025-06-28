// services/ishareService.js - Complete Updated Version
const axios = require('axios');

class IShareService {
  constructor() {
    this.endpoint = process.env.ISHARE_ENDPOINT || 'http://41.215.168.146:443/FlexiShareBundles.asmx';
    this.username = process.env.ISHARE_USERNAME || 'NetwiseSolutions';
    this.password = process.env.ISHARE_PASSWORD || 'f2fe6a63d960578490f3097d9447fcd0';
    this.dealerMsisdn = process.env.ISHARE_DEALER_MSISDN || '233270241113';
  }

  // Test connectivity to provider
  async testConnectivity() {
    try {
      console.log('=== Testing Provider Connectivity ===');
      console.log('Endpoint:', this.endpoint);
      console.log('Username:', this.username);
      console.log('Dealer MSISDN:', this.dealerMsisdn);

      // First, try a simple HTTP request to the endpoint
      const simpleResponse = await axios.get(this.endpoint, {
        timeout: 10000,
        validateStatus: function (status) {
          return status >= 200 && status < 600; // Accept any status
        }
      });

      console.log('Simple HTTP GET Response:');
      console.log('Status:', simpleResponse.status);
      console.log('Headers:', simpleResponse.headers);
      console.log('Data snippet:', simpleResponse.data.substring(0, 500) + '...');

      // Now try the balance check which is simpler than transfer
      console.log('\n=== Testing Balance Check ===');
      const balanceResult = await this.checkBalance();
      console.log('Balance check result:', balanceResult);

      return {
        connectivity: true,
        httpStatus: simpleResponse.status,
        balanceCheck: balanceResult,
        message: 'Connectivity test successful'
      };

    } catch (error) {
      console.error('=== Connectivity Test Failed ===');
      console.error('Error Type:', error.constructor.name);
      console.error('Error Message:', error.message);
      console.error('Error Code:', error.code);

      if (error.response) {
        console.error('Response Status:', error.response.status);
        console.error('Response Data:', error.response.data.substring(0, 500));
      }

      return {
        connectivity: false,
        error: error.message,
        errorCode: error.code,
        httpStatus: error.response?.status,
        message: 'Connectivity test failed'
      };
    }
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
      console.log('=== Balance Check Request ===');
      console.log('Endpoint:', this.endpoint);
      console.log('SOAP Request:', soapRequest);

      const response = await axios.post(this.endpoint, soapRequest, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://tempuri.org/FlexiShareBalanceCheck'
        },
        timeout: 30000, // 30 seconds timeout
        validateStatus: function (status) {
          return status >= 200 && status < 600; // Accept any status
        }
      });

      console.log('=== Balance Check Response ===');
      console.log('Status:', response.status);
      console.log('Raw Response:', response.data);

      return this.parseBalanceResponse(response.data);
    } catch (error) {
      console.error('=== Balance Check Error ===');
      console.error('Error Type:', error.constructor.name);
      console.error('Error Message:', error.message);
      console.error('Error Code:', error.code);

      if (error.response) {
        console.error('Response Status:', error.response.status);
        console.error('Response Data:', error.response.data);
      }

      throw new Error(`Failed to check iShare balance: ${error.message}`);
    }
  }

  // Send iShare transfer with enhanced error handling
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
      console.log('=== iShare Transfer Request ===');
      console.log('Endpoint:', this.endpoint);
      console.log('Original recipient:', recipientMsisdn);
      console.log('Formatted recipient:', formattedRecipient);
      console.log('Amount:', amountMB, 'MB');
      console.log('Transaction ID:', transactionId);
      console.log('SOAP Request:', soapRequest);
      
      const response = await axios.post(this.endpoint, soapRequest, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://tempuri.org/FlexiIshareBundle'
        },
        timeout: 60000, // 60 seconds timeout for transfers
        validateStatus: function (status) {
          // Accept any status code to see the actual response
          return status >= 200 && status < 600;
        }
      });

      console.log('=== Provider Response ===');
      console.log('Status:', response.status);
      console.log('Headers:', JSON.stringify(response.headers, null, 2));
      console.log('Raw Response Data:', response.data);

      // Parse the response regardless of status
      const parsedResponse = this.parseTransferResponse(response.data);
      console.log('Parsed Response:', JSON.stringify(parsedResponse, null, 2));

      return parsedResponse;

    } catch (error) {
      console.error('=== iShare Transfer Error Details ===');
      console.error('Error Type:', error.constructor.name);
      console.error('Error Message:', error.message);
      console.error('Error Code:', error.code);
      console.error('Error Stack:', error.stack);
      
      if (error.response) {
        // The request was made and the server responded with a status code
        console.error('Response Status:', error.response.status);
        console.error('Response Status Text:', error.response.statusText);
        console.error('Response Headers:', JSON.stringify(error.response.headers, null, 2));
        console.error('Response Data:', error.response.data);
        
        // Try to parse error response
        if (error.response.data) {
          try {
            const errorParsed = this.parseTransferResponse(error.response.data);
            console.error('Parsed Error Response:', JSON.stringify(errorParsed, null, 2));
            
            const errorMessage = errorParsed.message || 'Unknown provider error';
            const errorCode = errorParsed.responseCode || 'Unknown';
            throw new Error(`Provider Error: ${errorMessage} (Code: ${errorCode})`);
          } catch (parseError) {
            console.error('Could not parse error response:', parseError.message);
            throw new Error(`HTTP ${error.response.status}: ${error.response.data}`);
          }
        } else {
          throw new Error(`HTTP Error: ${error.response.status} - ${error.response.statusText}`);
        }
      } else if (error.request) {
        // The request was made but no response was received
        console.error('Request Details:', error.request);
        console.error('No response received from provider');
        
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Connection refused - Provider service may be down or unreachable');
        } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
          throw new Error('Connection timeout - Provider service is not responding');
        } else if (error.code === 'ENOTFOUND') {
          throw new Error('DNS resolution failed - Cannot find provider server');
        } else {
          throw new Error(`Network error: ${error.message} (${error.code || 'Unknown code'})`);
        }
      } else {
        // Something happened in setting up the request
        console.error('Request Setup Error:', error.message);
        throw new Error(`Request setup error: ${error.message}`);
      }
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
      console.log('=== Transaction Status Check ===');
      console.log('Transaction ID:', transactionId);
      console.log('SOAP Request:', soapRequest);

      const response = await axios.post(this.endpoint, soapRequest, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://tempuri.org/FlexiIshareTranxStatus'
        },
        timeout: 30000, // 30 seconds timeout
        validateStatus: function (status) {
          return status >= 200 && status < 600;
        }
      });

      console.log('=== Transaction Status Response ===');
      console.log('Status:', response.status);
      console.log('Raw Response:', response.data);

      return this.parseTransactionStatusResponse(response.data);
    } catch (error) {
      console.error('Transaction Status Check Error:', error.message);
      throw new Error(`Failed to check transaction status: ${error.message}`);
    }
  }

  // Enhanced parseBalanceResponse
  parseBalanceResponse(xmlResponse) {
    try {
      console.log('=== Parsing Balance Response ===');
      console.log('XML Response:', xmlResponse);

      // Check if response is HTML (error page) instead of XML
      if (typeof xmlResponse === 'string' && xmlResponse.trim().startsWith('<html')) {
        console.error('Received HTML response instead of XML');
        throw new Error('Provider returned HTML error page instead of XML response');
      }

      // Extract response code and message
      const responseCodeMatch = xmlResponse.match(/<ResponseCode>(\d+)<\/ResponseCode>/);
      const responseMsgMatch = xmlResponse.match(/<ResponseMsg>(.*?)<\/ResponseMsg>/);
      const dataBalanceMatch = xmlResponse.match(/<DataBalance>(\d+)<\/DataBalance>/);
      const expireTimeMatch = xmlResponse.match(/<ExpireTime>(.*?)<\/ExpireTime>/);

      const responseCode = responseCodeMatch ? responseCodeMatch[1] : null;
      const responseMsg = responseMsgMatch ? responseMsgMatch[1] : null;
      const dataBalance = dataBalanceMatch ? parseInt(dataBalanceMatch[1]) : 0;
      const expireTime = expireTimeMatch ? expireTimeMatch[1] : null;

      console.log('Extracted balance values:');
      console.log('- Response Code:', responseCode);
      console.log('- Response Message:', responseMsg);
      console.log('- Data Balance:', dataBalance, 'MB');
      console.log('- Expire Time:', expireTime);

      const result = {
        success: responseCode === '200',
        responseCode,
        message: responseMsg || 'No message from provider',
        balance: dataBalance,
        balanceInGB: (dataBalance / 1024).toFixed(2),
        expireTime,
        rawResponse: xmlResponse
      };

      console.log('Final balance result:', result);
      return result;

    } catch (error) {
      console.error('Error parsing balance response:', error);
      console.error('Raw XML that failed to parse:', xmlResponse);
      throw new Error(`Failed to parse balance response: ${error.message}`);
    }
  }

  // Enhanced parseTransferResponse
  parseTransferResponse(xmlResponse) {
    try {
      console.log('=== Parsing Transfer Response ===');
      console.log('XML Response:', xmlResponse);

      // Check if response is HTML (error page) instead of XML
      if (typeof xmlResponse === 'string' && xmlResponse.trim().startsWith('<html')) {
        console.error('Received HTML response instead of XML');
        return {
          success: false,
          responseCode: null,
          message: 'Provider returned HTML error page instead of XML response',
          systemTransactionId: null,
          vendorTransactionId: null,
          rawResponse: xmlResponse,
          parseError: 'HTML response received'
        };
      }

      const responseCodeMatch = xmlResponse.match(/<ResponseCode>(\d+)<\/ResponseCode>/);
      const responseMsgMatch = xmlResponse.match(/<ResponseMsg>(.*?)<\/ResponseMsg>/);
      const systemTranxMatch = xmlResponse.match(/<systemTranx_id>(.*?)<\/systemTranx_id>/);
      const vendorTranxMatch = xmlResponse.match(/<vendorTranx_id>(.*?)<\/vendorTranx_id>/);

      const responseCode = responseCodeMatch ? responseCodeMatch[1] : null;
      const responseMsg = responseMsgMatch ? responseMsgMatch[1] : null;
      const systemTranxId = systemTranxMatch ? systemTranxMatch[1] : null;
      const vendorTranxId = vendorTranxMatch ? vendorTranxMatch[1] : null;

      console.log('Extracted transfer values:');
      console.log('- Response Code:', responseCode);
      console.log('- Response Message:', responseMsg);
      console.log('- System Transaction ID:', systemTranxId);
      console.log('- Vendor Transaction ID:', vendorTranxId);

      // Get human-readable error message if available
      const humanReadableMessage = responseCode ? this.getErrorMessage(responseCode) : responseMsg;

      const result = {
        success: responseCode === '200',
        responseCode,
        message: responseMsg || humanReadableMessage || 'No message from provider',
        systemTransactionId: systemTranxId,
        vendorTransactionId: vendorTranxId,
        rawResponse: xmlResponse // Include raw response for debugging
      };

      console.log('Final transfer result:', result);
      return result;

    } catch (error) {
      console.error('Error parsing transfer response:', error);
      console.error('Raw XML that failed to parse:', xmlResponse);
      
      // Return a structured error response
      return {
        success: false,
        responseCode: null,
        message: `Failed to parse provider response: ${error.message}`,
        systemTransactionId: null,
        vendorTransactionId: null,
        rawResponse: xmlResponse,
        parseError: error.message
      };
    }
  }

  // Parse transaction status response
  parseTransactionStatusResponse(xmlResponse) {
    try {
      console.log('=== Parsing Transaction Status Response ===');
      console.log('XML Response:', xmlResponse);

      const responseMsgMatch = xmlResponse.match(/<ResponseMsg>(.*?)<\/ResponseMsg>/);
      const sharedBundleMatch = xmlResponse.match(/<SharedBundle>(\d+)<\/SharedBundle>/);
      const vendorTranxMatch = xmlResponse.match(/<VendorTranxId>(.*?)<\/VendorTranxId>/);
      const systemTranxMatch = xmlResponse.match(/<SystemTranxId>(.*?)<\/SystemTranxId>/);
      const senderMsisdnMatch = xmlResponse.match(/<SenderMsisdn>(.*?)<\/SenderMsisdn>/);
      const recipientMsisdnMatch = xmlResponse.match(/<RecipientMsisdn>(.*?)<\/RecipientMsisdn>/);

      const result = {
        message: responseMsgMatch ? responseMsgMatch[1] : null,
        sharedBundle: sharedBundleMatch ? parseInt(sharedBundleMatch[1]) : 0,
        vendorTransactionId: vendorTranxMatch ? vendorTranxMatch[1] : null,
        systemTransactionId: systemTranxMatch ? systemTranxMatch[1] : null,
        senderMsisdn: senderMsisdnMatch ? senderMsisdnMatch[1] : null,
        recipientMsisdn: recipientMsisdnMatch ? recipientMsisdnMatch[1] : null,
        rawResponse: xmlResponse
      };

      console.log('Transaction status result:', result);
      return result;

    } catch (error) {
      console.error('Error parsing transaction status response:', error);
      throw new Error(`Failed to parse transaction status response: ${error.message}`);
    }
  }

  // Format phone number to international format (12 digits)
  formatMsisdn(phoneNumber) {
    // Add debugging to see what we're receiving
    console.log('=== Phone Number Formatting ===');
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
      console.warn(`Valid prefixes are: ${validPrefixes.join(', ')}`);
      // Continue anyway as API might accept other formats
    }
    
    console.log('Final formatted number:', cleaned);
    console.log('=== End Phone Number Formatting ===');
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

    if (cleaned.length === 9 || cleaned.length === 10) {
      return { valid: true, cleaned: cleaned };
    } else if (cleaned.length === 12 && cleaned.startsWith('233')) {
      return { valid: true, cleaned: cleaned.substring(3) }; // Return 10-digit local format
    } else {
      return { 
        valid: false, 
        error: `Invalid phone number format. Expected 9-10 digits, got ${cleaned.length}`,
        received: cleaned
      };
    }
  }
}

module.exports = new IShareService();