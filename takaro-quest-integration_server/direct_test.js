// direct_test.js - Test the direct HTTP implementation
import DirectTakaroClient from './direct_takaro_client.js';

async function runDirectTest() {
  console.log('🧪 Running Direct HTTP Takaro Integration Tests');
  console.log('=' * 50);

  const client = new DirectTakaroClient();

  try {
    // Test 1: Authentication
    console.log('\n1️⃣ Testing direct HTTP authentication...');
    const authSuccess = await client.authenticate();
    
    if (!authSuccess) {
      console.error('❌ Direct authentication failed');
      console.log('\n🔍 Let\'s try to diagnose the issue...');
      
      // Try to check if we can reach the API at all
      try {
        const response = await client.makeRequest('GET', '/');
        console.log(`API reachable: Status ${response.status}`);
      } catch (error) {
        console.log(`API unreachable: ${error.message}`);
      }
      
      return;
    }

    console.log('\n✅ Direct HTTP authentication successful!');
    console.log('\n2️⃣ Testing basic API access...');
    
    // Try a simple API call
    try {
      const healthResponse = await client.makeRequest('GET', '/health');
      console.log(`Health check: Status ${healthResponse.status}`);
    } catch (error) {
      console.log(`Health check failed: ${error.message}`);
    }

    console.log('\n🎉 Direct HTTP tests completed!');
    console.log('You can now use the direct HTTP client instead of @takaro/apiclient');

  } catch (error) {
    console.error('❌ Direct test failed with error:', error.message);
  }
}

// Run the tests
runDirectTest();
