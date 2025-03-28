const PISAHash = artifacts.require("PISAHash");
const MultiChannelContract = artifacts.require("MultiChannelContract");
const DataRegistry = artifacts.require("DataRegistry");
const CommandChannelHandler = artifacts.require("CommandChannelHandler");
const MockAuction = artifacts.require("MockAuction");
const MockAuctionHandler = artifacts.require("MockAuctionHandler");
const assert = require("chai").assert;
const truffleAssert = require('truffle-assertions');

web3.providers.HttpProvider.prototype.sendAsync = web3.providers.HttpProvider.prototype.send;

advanceTimeAndBlock = async (time) => {
    await advanceTime(time);
    await advanceBlock();

    return Promise.resolve(web3.eth.getBlock('latest'));
}

advanceTime = (time) => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.sendAsync({
            jsonrpc: "2.0",
            method: "evm_increaseTime",
            params: [time],
            id: new Date().getTime()
        }, (err, result) => {
            if (err) { return reject(err); }
            return resolve(result);
        });
    });
}

advanceBlock = () => {
    return new Promise((resolve, reject) => {
        web3.currentProvider.sendAsync({
            jsonrpc: "2.0",
            method: "evm_mine",
            id: new Date().getTime()
        }, (err, result) => {
            if (err) { return reject(err); }
            const newBlockHash = web3.eth.getBlock('latest').hash;

            return resolve(newBlockHash)
        });
    });
}

// Stored for long-term use between tests.
let appointment; // Appointment array
let encodedAppointment; // Appointment encoding
let channelid; // Channel ID
let appointmentToSign; // Encodes the appointment + PISA contract address
let cussig; // Customer Accounts[3] signature
let pisasig; // PISA Accounts[3] signature

// Used as evidence to punish PISA.
let encodedLogTrigger;
let encodedLogResolve;
let datashard = new Array();
let dataindex = new Array();

function createToCall(_mode, _v) {

  if(_mode == 0) {
    return web3.eth.abi.encodeFunctionCall(
      {
          "constant": false,
          "inputs": [
              {
                 "name": "_v",
                 "type": "uint256"
              }
          ],
          "name": "evidence",
          "outputs": [],
          "payable": false,
          "stateMutability": "nonpayable",
          "type": "function"
      }, [_v]);
  }

  if(_mode == 1) {
    return web3.eth.abi.encodeFunctionCall(
      {
          "constant": false,
          "inputs": [{
            type: 'uint256',
            name: '_id'
          },{
            type: 'uint256',
            name: '_v'
          }],
          "name": "refute",
          "outputs": [],
          "payable": false,
          "stateMutability": "nonpayable",
          "type": "function"
      }, [channelid.toString(), _v]
    );
  }

  if(_mode == 2) {
    return web3.eth.abi.encodeParameters(['uint'], [42]);
  }

  if(_mode == 10) {
    return web3.eth.abi.encodeFunctionCall(
      {
          "constant": false,
          "inputs": [{
            type: 'uint256',
            name: '_value'
          },{
            type: 'uint256',
            name: '_r'
          }],
          "name": "revealBid",
          "outputs": [],
          "payable": false,
          "stateMutability": "nonpayable",
          "type": "function"
      }, [200, 123]
    );
  }

}

// function createAppointment(_sc, _blockNo, _cus, _v, _jobid, _mode) {
//
//

function createAppointment(_sc, _blockNo, _cus, _v, _jobid, _mode, _precondition, _postcondition, _minChallengePeriod) {

  let appointmentFinishTime = _blockNo + 100;
  let minChallengePeriod = _minChallengePeriod;
  let mode = _mode; // We know what dispute handler to use!
  let toCall = createToCall(mode, _v);
  let refund = 100; // 100 wei
  let gas = 1000000; // PISA will allocate up to 1m gas for this jobs
  let h = web3.utils.keccak256(web3.eth.abi.encodeParameter('uint', 123));

  appointment = new Array();
  appointment['starttime'] = _blockNo;
  appointment['finishtime'] = appointmentFinishTime;
  appointment['cus'] = _cus;
  appointment['id'] = channelid;
  appointment['jobid'] = _jobid;
  appointment['toCall'] = toCall;
  appointment['refund'] = refund;
  appointment['gas'] = gas;
  appointment['mode'] = mode;
  appointment['eventDesc'] = "doEvent(uint,uint,uint)";
  appointment['eventVals'] = [1,2,3];
  appointment['postcondition'] = _postcondition;
  appointment['h'] = h;
  appointment['r'] = web3.eth.abi.encodeParameter('uint', 123);
  appointment['v'] = _v;
  appointment['challengePeriod'] = minChallengePeriod;

  encodeEventDesc = web3.eth.abi.encodeParameter('string', appointment['eventDesc']);
  encodeEventVal = web3.eth.abi.encodeParameters(['uint','uint','uint'], appointment['eventVals']);

  let encodeAppointmentInfo = web3.eth.abi.encodeParameters(['uint','uint','uint','uint','uint','uint', 'bytes32'], [channelid.toString(), _jobid, _blockNo, appointmentFinishTime, minChallengePeriod, refund, h]);
  let encodeContractInfo = web3.eth.abi.encodeParameters(['address','address','uint', 'bytes'], [_sc, _cus, gas, toCall]);
  let encodeConditions = web3.eth.abi.encodeParameters(['bytes','bytes','bytes','bytes', 'uint'], [encodeEventDesc, encodeEventVal, _precondition, _postcondition, mode]);

  encodedAppointment =  web3.eth.abi.encodeParameters(['bytes','bytes','bytes'],[encodeAppointmentInfo, encodeContractInfo, encodeConditions]);
}


module.exports = {
    advanceTime,
    advanceBlock,
    advanceTimeAndBlock
}

function getCurrentTime() {
    return new Promise(function(resolve) {
      web3.eth.getBlock("latest").then(function(block) {
            resolve(block.timestamp)
        });
    })
}

function timeout(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


contract('PISAHash', (accounts) => {

  // var pisaHashInstance;
  let pisaHashInstance;
  //
  // PISAHash.new(DataRegistry.address, 2, 300, accounts[0]).then(function(instance) {
  //    pisaHashInstance = instance;
  // });

  it('Setup and install watcher', async () => {
    var accounts =  await web3.eth.getAccounts();
    pisaHashInstance = await PISAHash.deployed();
    // Make sure it is set to OK
    let flag = await pisaHashInstance.flag.call();
    assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

    // Go a few blocks into the future...
    // So we can "inspect the past" safely
    for(let i=0; i<100; i++) {
        await advanceBlock();
    }
    // Some time in the future
    let blockNo = await web3.eth.getBlockNumber();
    blockNo = blockNo + 10;

    // Install a watcher using the cold-storage admin key.
    let toSign = web3.eth.abi.encodeParameters(['address','uint','address'], [accounts[1], blockNo, pisaHashInstance.address]);
    let hash = web3.utils.keccak256(toSign);
    var sig =  await web3.eth.sign(hash,accounts[0]);
    let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig);
    assert.equal(signerAddr, accounts[0], "Signer address should be the same");

    await pisaHashInstance.installWatcher(accounts[1], blockNo, sig, {from: accounts[2]});
    let isWatcher = await pisaHashInstance.isWatcher.call(accounts[1]);
    assert.isTrue(isWatcher, "Watcher is installed");

    // Fail to install a watcher due to time
    blockNo = blockNo - 10;
    toSign = web3.eth.abi.encodeParameters(['address','uint','address'], [accounts[2], blockNo, pisaHashInstance.address]);
    hash = web3.utils.keccak256(toSign);
    sig =  await web3.eth.sign(hash,accounts[0]);
    await truffleAssert.reverts(pisaHashInstance.installWatcher(accounts[2], blockNo, sig, {from: accounts[3]}), "too late to install");
  });

  it('Fund channel accounts[3] <-> accounts[4] in MultiChannelContract by accounts[3]', async () => {
    var challengeInstance = await MultiChannelContract.deployed();
    // Create channel for two accounts
    await challengeInstance.fundChannel(accounts[3], accounts[4], {from: accounts[3]});
    channelid = await challengeInstance.getChannelID.call(accounts[3], accounts[4]);

    // console.log("Channel ID: " + channelid);
    assert.isTrue(channelid != 0, "Channel ID should not be 0");
  });

  it('Install Condition Handlers', async () => {
      var postconditionHandler = await CommandChannelHandler.deployed();
      var accounts =  await web3.eth.getAccounts();

      // Make sure it is set to OK
      let flag = await pisaHashInstance.flag.call();
      assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

      // Some time in the future
      let blockNo = await web3.eth.getBlockNumber();
      blockNo = blockNo + 10;

      // Install a watcher using the cold-storage admin key
      let toSign = web3.eth.abi.encodeParameters(['address', 'address', 'address', 'uint','uint', 'address'], ["0x0000000000000000000000000000000000000000", postconditionHandler.address, postconditionHandler.address, 1, blockNo, pisaHashInstance.address]);
      let hash = web3.utils.keccak256(toSign);
      let sig =  await web3.eth.sign(hash,accounts[0]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig);
      assert.equal(signerAddr, accounts[0], "Signer address should be the same");

      // Ready to install handler
      await pisaHashInstance.installMode("0x0000000000000000000000000000000000000000", postconditionHandler.address, postconditionHandler.address, 1, blockNo, sig, {from: accounts[2]});

      // Was the handler installed ok?
      let getMode = await pisaHashInstance.getMode.call(1);
      assert.equal(getMode[0][1], postconditionHandler.address);
    });

    it('Basic test (PISA will respond OK) - Create a PISA appointment for MultiChannelContract', async () => {
      var challengeInstance = await MultiChannelContract.deployed();
      var registryInstance  = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Confirm account[1] is a watcher (dependent on previous test)
      let isWatcher = await pisaHashInstance.isWatcher.call(accounts[1]);
      assert.isTrue(isWatcher, "Watcher is installed");

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo, accounts[3], 50, 10, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 50), 50);

      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
      let hash = web3.utils.keccak256(appointmentToSign);

      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");
    });

    it('Basic test (PISA will respond OK) - Trigger in MultiChannelContract', async () => {
      var challengeInstance = await MultiChannelContract.deployed();
      var registryInstance  = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Trigger challenge
      await challengeInstance.trigger(channelid);

      let timenow = await getCurrentTime();
      let shard = await registryInstance.getDataShardIndex.call(timenow);
      let recordHash = await registryInstance.fetchHash.call(shard, challengeInstance.address, channelid, 0);
      assert.isTrue(recordHash.length != 0, "Data should be stored!");

      // Decoded will be block.number, challengePeriod, v
      blockNo = await web3.eth.getBlockNumber();
      let encodedRecord = web3.eth.abi.encodeParameters(["uint","uint","uint","uint"], [0, blockNo, 50, 0]);
      let h = web3.utils.keccak256(encodedRecord);

      assert.equal(recordHash, h, "Trigger record hash for MultiChannelContract should match");

    });

    it('Basic test (PISA will respond OK) - PISA responds on behalf of customer', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();
      let timenow = await getCurrentTime();
      let shard = await registryInstance.getDataShardIndex.call(timenow);

      // PISA MUST RESPOND. Should not fail!
      await pisaHashInstance.respond(challengeInstance.address, accounts[3], appointment['id'], appointment['jobid'], appointment['mode'], appointment['toCall'], appointment['gas'], "0x0000000000000000000000000000000000000000", {from: accounts[1]});
      let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint', 'uint'], [challengeInstance.address, appointment['cus'], channelid.toString(), appointment['jobid']]);
      let pisaid = web3.utils.keccak256(pisaidEncoded);
      let pisaRecord = await registryInstance.fetchRecord.call(shard, pisaHashInstance.address, pisaid, 0);
      assert.isTrue(pisaRecord.length != 0, "Data should be stored!");

      // TODO: We should decode to "bytes" not "bytes32", getting a 53 bits error.
      let pisa_decoded_record = web3.eth.abi.decodeParameters(["uint", "bytes32"], pisaRecord);
      assert.equal(pisa_decoded_record[0], blockNo+1, "Response block number");

      let v = await challengeInstance.getV.call(channelid.toString());
      assert.equal(v, appointment['v'],"v should be 50");
    });

    it('PISA will NOT respond - Trigger dispute in MultiChannelContract', async () => {
      var challengeInstance = await MultiChannelContract.deployed();
      var registryInstance  = await DataRegistry.deployed();
      var accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Trigger challenge
      await challengeInstance.trigger(channelid);

      let flag = await challengeInstance.getFlag(channelid.toString());
      assert.equal(flag, 1, "Flag is set to challenge");

      let timenow = await getCurrentTime();
      let shard = await registryInstance.getDataShardIndex.call(timenow);
      let recordHash = await registryInstance.fetchHash.call(shard, challengeInstance.address, channelid, 1);
      datashard[0] = shard;
      dataindex[0] = 1;
      assert.isTrue(recordHash.length != 0, "Data should be stored!");

      // Decoded will be block.number, challengePeriod, v
      blockNo = await web3.eth.getBlockNumber();
      encodedLogTrigger = web3.eth.abi.encodeParameters(["uint","uint", "uint", "uint"], [0, blockNo, 50, 50]);
      let h = web3.utils.keccak256(encodedLogTrigger);
      assert.equal(recordHash, h, "Trigger hash from MultiChannelContract should match");

      // Go a few blocks into the future...
      for(let i=0; i<100; i++) {
          await advanceBlock();
      }

      // Resolve dispute...
      await challengeInstance.resolve(channelid.toString());
      flag = await challengeInstance.getFlag(channelid.toString());
      assert.equal(flag, 0, "Flag is set to resolved");

      // OK let's check that the hash matches up
      recordHash = await registryInstance.fetchHash.call(shard, challengeInstance.address, channelid, 2);
      datashard[1] = shard;
      dataindex[1] = 2;
      assert.isTrue(recordHash.length != 0, "Data should be stored!");

      blockNo = await web3.eth.getBlockNumber();
      encodedLogResolve = web3.eth.abi.encodeParameters(["uint","uint", "uint"], [1, blockNo, 51]);
      h = web3.utils.keccak256(encodedLogResolve);
      assert.equal(recordHash, h, "Resolve hash from MultiChannelContract");

    });

    it('PISA will NOT respond  - Seek recourse against PISA and FAIL due to bad minimum challenge time', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo-110, accounts[3], 100, 20, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 100), 100);

      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);

      // Customer signs job
      let hash = web3.utils.keccak256(appointmentToSign);
      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      // PISA signs job
      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid.toString(), dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid.toString(), dataindex[1]);
      assert.isTrue(resolveRecord.length != 0, "Resolve data should be stored!");

      // Combine signatures.... produced in previous test.
      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;

      // // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Contract did not abide by minimum challenge time");

      // Confirm there are no outstanding refunds
      let pendingRefunds = await pisaHashInstance.getPendingRefunds.call();
      assert.equal(pendingRefunds, 0, "Should be no outstanding refunds");
    });

    it('PISA will NOT respond - Seek recourse against PISA and FAIL due to dispute happening before start time)', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo, accounts[3], 100, 20, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 100), 50);

      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);

      // Customer signs job
      let hash = web3.utils.keccak256(appointmentToSign);
      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      // PISA signs job
      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid.toString(), dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid.toString(), dataindex[1]);
      assert.isTrue(resolveRecord.length != 0, "Resolve data should be stored!");

      // Combine signatures.... produced in previous test.
      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;

      // // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Dispute started before appointment time....");

      // Confirm there are no outstanding refunds
      let pendingRefunds = await pisaHashInstance.getPendingRefunds.call();
      assert.equal(pendingRefunds, 0, "Should be no outstanding refunds");
    });

    it('PISA will NOT respond - Seek recourse against PISA and FAIL due to dispute happening after finish time)', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo-210, accounts[3], 100, 20, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 100), 50);

      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);

      // Customer signs job
      let hash = web3.utils.keccak256(appointmentToSign);
      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      // PISA signs job
      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid.toString(), dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid.toString(), dataindex[1]);
      assert.isTrue(resolveRecord.length != 0, "Resolve data should be stored!");

      // Combine signatures.... produced in previous test.
      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;

      // // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Dispute started after appointment time...");

      // Confirm there are no outstanding refunds
      let pendingRefunds = await pisaHashInstance.getPendingRefunds.call();
      assert.equal(pendingRefunds, 0, "Should be no outstanding refunds");
    });


    it('PISA will NOT respond  - Creates a valid PISA appointment for MultiChannelContract', async () => {
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();
      let blockNo = await web3.eth.getBlockNumber();

      // Confirm account[1] is a watcher (dependent on previous test)
      let isWatcher = await pisaHashInstance.isWatcher.call(accounts[1]);
      assert.isTrue(isWatcher, "Watcher is installed");

      // Accounts[3] = customer
      // Accounts[1] = watcher
      createAppointment(challengeInstance.address, blockNo-110, accounts[3], 100, 20, 1, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 100), 50);
      appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);

      // Customer signs job
      let hash = web3.utils.keccak256(appointmentToSign);
      cussig =  await web3.eth.sign(hash,accounts[3]);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      // PISA signs job
      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");
    });

    it('PISA will NOT respond - Customer seeks recourse using valid receipt against PISA and they win', async () => {
      // Really we should NEVER be in this situation....
      // accepting a much larger "v" in an earlier receipt... but
      // bugs can happen and we should be protected from it becuase the _jobid
      // remains acceptable
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();
      let accounts =  await web3.eth.getAccounts();

      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid.toString(), dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid.toString(), dataindex[1]);
      assert.isTrue(resolveRecord.length != 0, "Resolve data should be stored!");

      // Combine signatures.... produced in previous test.
      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;

      let hash = web3.utils.keccak256(appointmentToSign);
      let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
      assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

      pisasig =  await web3.eth.sign(hash,accounts[1]);
      signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
      assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

      // // It should revert due to failure to decode fetched data from registry (i.e. it doesnt exist, how can we decode it?!)
      await pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex);

      let pendingRefunds = await pisaHashInstance.getPendingRefunds.call();
      assert.equal(pendingRefunds, 1, "Only 1 refund outstanding");

      // Should revert... we already issued recourse
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Recourse was already successful");

    });

    it('PISA will NOT respond  - PISA refunds the customer 100 wei', async () => {
      // Really we should NEVER be in this situation....
      // accepting a much larger "v" in an earlier receipt... but
      // bugs can happen and we should be protected from it becuase the _jobid
      // remains acceptable
      let accounts =  await web3.eth.getAccounts();
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();

      let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint', 'uint'], [challengeInstance.address, appointment['cus'], channelid.toString(), appointment['jobid']]);
      let pisaid = web3.utils.keccak256(pisaidEncoded);

      await truffleAssert.reverts(pisaHashInstance.forfeit(pisaid), "Time has not yet passed since refund was due by PISA");

      await pisaHashInstance.refundCustomer(challengeInstance.address, appointment['cus'], channelid.toString(), appointment['jobid'], {value: 100});

      let pendingRefunds = await pisaHashInstance.getPendingRefunds.call();
      assert.equal(pendingRefunds, 0, "No more pending refunds... all good!");

      let cheatedlog = await pisaHashInstance.cheated.call(pisaid);

      // Cheated log should be eresolved!
      assert.isTrue(cheatedlog['resolved']);

      // Again, issuing the same evidence should fail too
      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid.toString(), dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid.toString(), dataindex[1]);
      assert.isTrue(resolveRecord.length != 0, "Resolve data should be stored!");

      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Recourse was already successful");


    });

    it('PISA will NOT respond - Try recourse again with same evidence, fails as it was already issued', async () => {
      // Really we should NEVER be in this situation....
      // accepting a much larger "v" in an earlier receipt... but
      // bugs can happen and we should be protected from it becuase the _jobid
      // remains acceptable
      let accounts =  await web3.eth.getAccounts();
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();

      let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint', 'uint'], [challengeInstance.address, appointment['cus'], channelid.toString(), appointment['jobid']]);
      let pisaid = web3.utils.keccak256(pisaidEncoded);

      // Again, issuing the same evidence should fail too
      let triggerRecord = await registryInstance.fetchHash.call(datashard[0], challengeInstance.address, channelid.toString(), dataindex[0]);
      assert.isTrue(triggerRecord.length != 0, "Trigger data should be stored!");

      let resolveRecord = await registryInstance.fetchHash.call(datashard[1], challengeInstance.address, channelid.toString(), dataindex[1]);
      assert.isTrue(resolveRecord.length != 0, "Resolve data should be stored!");

      let sigs = [pisasig, cussig];
      let logdata = new Array();
      logdata[0] = encodedLogTrigger;
      logdata[1] = encodedLogResolve;
      await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "Recourse was already successful");
    });

    it('PISA will NOT respond - Customer withdraws refund', async () => {
      // Really we should NEVER be in this situation....
      // accepting a much larger "v" in an earlier receipt... but
      // bugs can happen and we should be protected from it becuase the _jobid
      // remains acceptable
      let accounts =  await web3.eth.getAccounts();
      let challengeInstance = await MultiChannelContract.deployed();
      let registryInstance  = await DataRegistry.deployed();

      await pisaHashInstance.customerWithdrawRefund(challengeInstance.address, appointment['cus'], channelid.toString(), appointment['jobid']);

      let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint', 'uint'], [challengeInstance.address, appointment['cus'], channelid.toString(), appointment['jobid']]);
      let pisaid = web3.utils.keccak256(pisaidEncoded);

      let cheatedlog = await pisaHashInstance.cheated.call(pisaid);

      // Cheated log should be eresolved!
      assert.equal(cheatedlog['refund'], 0);

    });


    it('Accountable Relay Transaction - Install mode handler so PISA has to respond between time t1 and t2', async () => {
        var accounts =  await web3.eth.getAccounts();

        // Make sure it is set to OK
        let flag = await pisaHashInstance.flag.call();
        assert.equal(flag.toNumber(), 0 ,"Flag should be OK = 0");

        // Some time in the future
        let blockNo = await web3.eth.getBlockNumber();
        blockNo = blockNo + 10;

        // Install a watcher using the cold-storage admin key
        let toSign = web3.eth.abi.encodeParameters(['address', 'address', 'address', 'uint','uint', 'address'], ["0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 2, blockNo, pisaHashInstance.address]);
        let hash = web3.utils.keccak256(toSign);
        let sig =  await web3.eth.sign(hash,accounts[0]);
        let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig);
        assert.equal(signerAddr, accounts[0], "Signer address should be the same");

        // Ready to install handler
        await pisaHashInstance.installMode("0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 2, blockNo, sig, {from: accounts[2]});

        // Was the handler installed ok?
        let getMode;
        (getMode) = await pisaHashInstance.getMode.call(2);

        assert.equal(getMode[0][0], "0x0000000000000000000000000000000000000000", "No precondition should be installed");
        assert.equal(getMode[0][1], "0x0000000000000000000000000000000000000000", "No postcondition should be installed");
        assert.equal(getMode[0][2], "0x0000000000000000000000000000000000000000", "No challenge time should be installed");
        assert.isTrue(getMode[1]);

      });

      it('Accountable Relay Transaction - Sign appointment to send tx between t1 adn t2', async () => {
          let challengeInstance = await MultiChannelContract.deployed();
          var accounts =  await web3.eth.getAccounts();
          let blockNo = await web3.eth.getBlockNumber();

          // Accounts[3] = customer
          // Accounts[1] = watcher
          createAppointment(challengeInstance.address, blockNo, accounts[3], 150, 28, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 150), 50);

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          pisasig =  await web3.eth.sign(hash,accounts[1]);
          signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
          assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");
      });

      it('Accountable Relay Transaction - Customer issue recourse for jobid 28 (successful)', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();

          // Go a few blocks into the future...
          for(let i=0; i<150; i++) {
              await advanceBlock();
          }

          // We really only need signed appointment + both sigs
          let sigs = [pisasig, cussig];
          let logdata = new Array()
          let datashard = new Array();
          let dataindex = new Array();

          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint', 'uint'], [challengeInstance.address, appointment['cus'], channelid.toString(), appointment['jobid']]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);

          let cheatedlog = await pisaHashInstance.cheated.call(pisaid);

          // Cheated log should be triggered, but not resolved!
          assert.isTrue(!cheatedlog['triggered']);
          assert.isTrue(!cheatedlog['resolved']);

          // Recourse should work.... all we care is if PISA called a function between two times.
          // But it didnt and no log was recorded. Bad PISA.
          await pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex);

          // One refund should be pending
          let pendingRefunds = await pisaHashInstance.getPendingRefunds.call();
          assert.equal(pendingRefunds, 1, "Only 1 refund outstanding");

          cheatedlog = await pisaHashInstance.cheated.call(pisaid);

          // Cheated log should be resolved now!
          assert.isTrue(cheatedlog['triggered']);
          assert.isTrue(!cheatedlog['resolved']);

      });

      it('Accountable Relay Transaction - PISA provides appointment (with same jobid 28) signed by customer. PISA fails to cancel recourse', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Change Job ID to something in the future.
          createAppointment(challengeInstance.address, blockNo, accounts[3], 200, 28, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 200), 50);

          // OK lets try to compute pisaid locally after creating a new appointment
          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint', 'uint'], [challengeInstance.address, appointment['cus'], channelid.toString(), 28]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);
          let cheatedlog = await pisaHashInstance.cheated.call(pisaid);
          assert.isTrue(cheatedlog['triggered'], "Recourse for job id 28 should be triggered");
          assert.isTrue(!cheatedlog['resolved'], "Recourse for job id 28 should not already be resolved");

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          // Prove customer has approved a new appointment from us.
          await truffleAssert.reverts(pisaHashInstance.customerCancelledJob(encodedAppointment, cussig, 28), "Appointment did not have a future jobid");

          // One refund should be pending
          let pendingRefunds = await pisaHashInstance.getPendingRefunds.call();
          cheatedlog = await pisaHashInstance.cheated.call(pisaid);
          assert.equal(pendingRefunds, 1, "1 refund should be outstanding");
          assert.isTrue(cheatedlog['triggered'], "Recourse for job id 28 should be triggered");
          assert.isTrue(!cheatedlog['resolved'], "Recourse for job id 28 should NOT be resolved");

      });

      it('Accountable Relay Transaction - PISA provides signed (by customer) appointment with new jobid (30), cancels recourse ', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Change Job ID to something in the future.
          createAppointment(challengeInstance.address, blockNo, accounts[3], 200, 30, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 200), 50);

          // OK lets try to compute pisaid locally after creating a new appointment
          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint', 'uint'], [challengeInstance.address, appointment['cus'], channelid.toString(), 28]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);
          let cheatedlog = await pisaHashInstance.cheated.call(pisaid);
          assert.isTrue(cheatedlog['triggered'], "Recourse for job id 28 should be triggered");
          assert.isTrue(!cheatedlog['resolved'], "Recourse for job id 28 should not already be resolved");

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          // Prove customer has approved a new appointment from us.
          await pisaHashInstance.customerCancelledJob(encodedAppointment, cussig, 28);

          // One refund should be pending
          let pendingRefunds = await pisaHashInstance.getPendingRefunds.call();
          cheatedlog = await pisaHashInstance.cheated.call(pisaid);
          assert.equal(pendingRefunds, 0, "No refund outstanding");
          assert.isTrue(cheatedlog['triggered'], "Recourse for job id 28 should be triggered");
          assert.isTrue(cheatedlog['resolved'], "Recourse for job id 28 should be resolved");

      });

      it('Precondition Test - Install handler for Auctions', async () => {
          var accounts =  await web3.eth.getAccounts();
          let mockAuctionHandler = await MockAuctionHandler.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Install a watcher using the cold-storage admin key
          let toSign = web3.eth.abi.encodeParameters(['address', 'address', 'address', 'uint','uint', 'address'], [mockAuctionHandler.address, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 10, blockNo+10, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(toSign);
          let sig =  await web3.eth.sign(hash,accounts[0]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig);
          assert.equal(signerAddr, accounts[0], "Signer address should be the same");

          await pisaHashInstance.installMode(mockAuctionHandler.address, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 10, blockNo+10, sig, {from: accounts[2]});

      });


      // Next TWO tests let us check whether the "precondition" functionality works
      // Really, PISA shouldn't respond until the auction is in "REVEALBID" mode.
      // So this test should try before the mode and the call fails
      // In the next call.... we change the mode and the call will work! yay!
      it('Precondition Test - PISA signs new appointment for AUCTION and PISA responds too early (test precondition)', async () => {
          var accounts =  await web3.eth.getAccounts();
          let mockAuction = await MockAuction.deployed();
          let mockAuctionHandler = await MockAuctionHandler.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Change Job ID to something in the future.
          createAppointment(mockAuction.address, blockNo-10, accounts[3], 500, 37, 10, mockAuctionHandler.address, "0x0000000000000000000000000000000000000000", 50);

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          pisasig =  await web3.eth.sign(hash,accounts[1]);
          signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
          assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

          // Go a few blocks into the future...
          for(let i=0; i<5; i++) {
              await advanceBlock();
          }

          await truffleAssert.reverts(pisaHashInstance.respond(mockAuction.address, accounts[3], appointment['id'], appointment['jobid'], appointment['mode'], appointment['toCall'], appointment['gas'], mockAuctionHandler.address, {from: accounts[1]}));

      });

      it('Precondition Test - MockAuction flag transitions and PISA response works ', async () => {
          var accounts =  await web3.eth.getAccounts();
          let mockAuction = await MockAuction.deployed();
          let mockAuctionHandler = await MockAuctionHandler.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Transition flag... so we can now start to reveal the big!
          await mockAuction.transitionFlag();

          let flag = await mockAuction.getAuctionFlag.call();

          assert.equal(flag,1,"Flag should be set to REVEALBID");

          await pisaHashInstance.respond(mockAuction.address, accounts[3], appointment['id'], appointment['jobid'], appointment['mode'], appointment['toCall'], appointment['gas'], mockAuctionHandler.address, {from: accounts[1]});

          let lastSender = await mockAuction.lastSender.call();

          assert.equal(lastSender, pisaHashInstance.address, "PISA should be recorded as the immediate caller...");
      });

      it('Precondition Test - PISA signs new appointment and responds for customer after some time', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let registryInstance  = await DataRegistry.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Change Job ID to something in the future.
          createAppointment(challengeInstance.address, blockNo-10, accounts[3], 500, 40, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 500), 50);

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          pisasig =  await web3.eth.sign(hash,accounts[1]);
          signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
          assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

          // Go a few blocks into the future...
          for(let i=0; i<5; i++) {
              await advanceBlock();
          }

          await pisaHashInstance.respond(challengeInstance.address, accounts[3], appointment['id'], appointment['jobid'], appointment['mode'], appointment['toCall'], appointment['gas'], "0x0000000000000000000000000000000000000000", {from: accounts[1]});

          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint', 'uint'], [challengeInstance.address, appointment['cus'], channelid.toString(), appointment['jobid']]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);
          let timenow = await getCurrentTime();
          let shard = await registryInstance.getDataShardIndex.call(timenow);

          let pisaRecord = await registryInstance.fetchRecord.call(shard, pisaHashInstance.address, pisaid, 0);
          assert.isTrue(pisaRecord.length != 0, "Data should be stored!");

      });

      it('Precondition Test - Customer issue recourse for jobid 40 (PISA responded, recourse fails)', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();

          // Go a few blocks into the future...
          for(let i=0; i<150; i++) {
              await advanceBlock();
          }

          // We really only need signed appointment + both sigs
          let sigs = [pisasig, cussig];
          let logdata = new Array()
          let datashard = new Array();
          let dataindex = new Array();

          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint', 'uint'], [challengeInstance.address, appointment['cus'], channelid.toString(), appointment['jobid']]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);

          let cheatedlog = await pisaHashInstance.cheated.call(pisaid);

          // Cheated log should be triggered, but not resolved!
          assert.isTrue(!cheatedlog['triggered']);
          assert.isTrue(!cheatedlog['resolved']);

          // PISA did its job. Recourse should fail.
          await truffleAssert.reverts(pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex), "PISA sent the right job during the appointment time");

          // One refund should be pending
          let pendingRefunds = await pisaHashInstance.getPendingRefunds.call();
          assert.equal(pendingRefunds, 0, "No refunds outstanding");

          cheatedlog = await pisaHashInstance.cheated.call(pisaid);

          // Cheated log NOT be trigred OR resolved!
          assert.isTrue(!cheatedlog['triggered']);
          assert.isTrue(!cheatedlog['resolved']);

      });

      it('Precondition Test - PISA signs new appointment, PISA does not respond or refund. Customer forfeits us', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let registryInstance  = await DataRegistry.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          // Change Job ID to something in the future.
          createAppointment(challengeInstance.address, blockNo-10, accounts[3], 1230, 50, 2, "0x0000000000000000000000000000000000000000", web3.eth.abi.encodeParameter('uint', 1230), 50);

          appointmentToSign = web3.eth.abi.encodeParameters(['bytes','address'],[encodedAppointment, pisaHashInstance.address]);
          let hash = web3.utils.keccak256(appointmentToSign);

          cussig =  await web3.eth.sign(hash,accounts[3]);
          let signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,cussig);
          assert.equal(signerAddr, accounts[3], "Customer signer address should be the same");

          pisasig =  await web3.eth.sign(hash,accounts[1]);
          signerAddr = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,pisasig);
          assert.equal(signerAddr, accounts[1], "PISA signer address should be the same");

          // Go a few blocks into the future...
          for(let i=0; i<150; i++) {
              await advanceBlock();
          }

          let logdata = new Array();
          let datashard = new Array();
          let dataindex = new Array();
          let sigs = [pisasig, cussig];

          await pisaHashInstance.recourse(encodedAppointment, sigs, appointment['r'], logdata, datashard, dataindex);

          let pendingRefunds = await pisaHashInstance.getPendingRefunds.call();
          assert.equal(pendingRefunds, 1, "1 refund should be outstanding");

          // Go a few blocks into the future...
          for(let i=0; i<300; i++) {
              await advanceBlock();
          }

          // We have missed the refund period.... make us forfeit!!
          let pisaidEncoded= web3.eth.abi.encodeParameters(['address', 'address', 'uint', 'uint'], [challengeInstance.address, appointment['cus'], channelid.toString(), appointment['jobid']]);
          let pisaid = web3.utils.keccak256(pisaidEncoded);

          await pisaHashInstance.forfeit(pisaid);

          let flag = await pisaHashInstance.flag.call();
          assert.equal(flag, 1, "PISA should be in the cheated state");

      });

      it('FAIL SAFE - let us recover with distributed agreement', async () => {
          var accounts =  await web3.eth.getAccounts();
          let challengeInstance = await MultiChannelContract.deployed();
          let registryInstance  = await DataRegistry.deployed();
          let blockNo = await web3.eth.getBlockNumber();

          let encoded = web3.eth.abi.encodeParameters(['address','string'],[pisaHashInstance.address, "frozen"]);
          let hash = web3.utils.keccak256(encoded);
          let sig1 =  await web3.eth.sign(hash,accounts[7]);
          let signerAddr1 = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig1);
          assert.equal(signerAddr1, accounts[7], "Defender[7] address should be the same");

          let sig2 =  await web3.eth.sign(hash,accounts[9]);
          let signerAddr2 = await pisaHashInstance.recoverEthereumSignedMessage.call(hash,sig2);
          assert.equal(signerAddr2, accounts[9], "Defender[9] address should be the same");

          await pisaHashInstance.failSafe([sig1,sig2],[2,4]);

          let flag = await pisaHashInstance.flag.call();
          assert.equal(flag, 0, "PISA should be back to the OK state");


      });
});
