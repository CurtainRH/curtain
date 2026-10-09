// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import {
    PoolV2TransferPlonkVerifierAdapter,
    IGeneratedPoolTransferPlonkVerifier
} from "../../src/pool/PoolV2TransferPlonkVerifierAdapter.sol";

contract GeneratedPoolTransferPlonkVerifierStub is IGeneratedPoolTransferPlonkVerifier {
    bool public result;
    uint256[] public expectedSignals;

    function setResult(bool result_) external {
        result = result_;
    }

    function setExpectedSignals(uint256[] calldata signals) external {
        expectedSignals = signals;
    }

    function verifyProof(uint256[] calldata, uint256[] calldata signals) external view returns (bool) {
        if (signals.length != expectedSignals.length) return false;
        for (uint256 i; i < signals.length; ++i) {
            if (signals[i] != expectedSignals[i]) return false;
        }
        return result;
    }
}

contract PoolV2TransferPlonkVerifierAdapterTest is Test {
    GeneratedPoolTransferPlonkVerifierStub generated;
    PoolV2TransferPlonkVerifierAdapter adapter;

    function setUp() public {
        generated = new GeneratedPoolTransferPlonkVerifierStub();
        adapter = new PoolV2TransferPlonkVerifierAdapter(address(generated));
    }

    function testDecodesProofAndMapsFivePublicInputs() public {
        uint256[] memory proof = new uint256[](3);
        proof[0] = 1;
        proof[1] = 2;
        proof[2] = 3;
        uint256[] memory expected = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            expected[i] = i + 11;
        }
        generated.setExpectedSignals(expected);
        generated.setResult(true);
        bytes32[] memory publicInputs = new bytes32[](5);
        for (uint256 i; i < 5; ++i) {
            publicInputs[i] = bytes32(expected[i]);
        }

        assertTrue(adapter.verify(abi.encode(proof), publicInputs));
    }

    function testReturnsFalseForMalformedProofOrPublicInputs() public {
        bytes32[] memory publicInputs = new bytes32[](5);
        assertFalse(adapter.verify(hex"", publicInputs));
        bytes32[] memory wrongInputs = new bytes32[](4);
        assertFalse(adapter.verify(abi.encode(new uint256[](3)), wrongInputs));
    }
}
