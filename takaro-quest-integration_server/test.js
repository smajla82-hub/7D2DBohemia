// test.js - Test the Takaro integration
import TakaroQuestClient from './takaro_client.js';

async function runTests() {
  console.log('🧪 Running Takaro Integration Tests');
  console.log('=' * 40);

  const client = new TakaroQuestClient();

  try {
    // Test 1: Authentication
    console.log('\n1️⃣ Testing authentication...');
    const authSuccess = await client.authenticate();
    if (!authSuccess) {
      console.error('❌ Authentication failed - stopping tests');
      return;
    }

    // Test 2: Player lookup (use a real player name if you have one)
    console.log('\n2️⃣ Testing player lookup...');
    // You might need to replace this with an actual player name from your server
    const testPlayerName = 'TestPlayer'; // Change this to a real player name
    const playerId = await client.findPlayerByName(testPlayerName);
    
    if (playerId) {
      console.log(`✅ Found player: ${testPlayerName} -> ${playerId}`);
      
      // Test 3: Quest update
      console.log('\n3️⃣ Testing quest update...');
      const questResult = await client.handleQuestUpdate(testPlayerName, 'vote', 1);
      
      if (questResult.success) {
        console.log('✅ Quest update successful!');
        console.log('Quest data:', questResult.questData);
      } else {
        console.log('❌ Quest update failed:', questResult.error);
      }
      
    } else {
      console.log(`⚠️ Player ${testPlayerName} not found. This is normal if the player doesn't exist.`);
      console.log('   Try changing testPlayerName to an actual player from your server.');
    }

    // Test 4: Message sending
    console.log('\n4️⃣ Testing message sending...');
    const messageSuccess = await client.sendPlayerMessage(testPlayerName, 'Test message from integration!');
    console.log(messageSuccess ? '✅ Message sent successfully' : '❌ Message sending failed');

    console.log('\n🎉 Tests completed!');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the tests
runTests();
