// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import {
    PoolV2TransferVerifierAdapter,
    IGeneratedPoolTransferVerifier
} from "../../src/pool/PoolV2TransferVerifierAdapter.sol";

contract GeneratedPoolTransferVerifierStub is IGeneratedPoolTransferVerifier {
    bool public result;
    uint256[5] public expectedInput;

    function setResult(bool result_) external {
        result = result_;
    }

    function setExpectedInput(uint256[5] calldata input) external {
        expectedInput = input;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[5] calldata input)
        external
        view
        returns (bool)
    {
        for (uint256 i; i < 5; ++i) {
            if (input[i] != expectedInput[i]) return false;
        }
        return result;
    }
}

contract PoolV2TransferVerifierAdapterTest is Test {
    GeneratedPoolTransferVerifierStub generated;
    PoolV2TransferVerifierAdapter adapter;

    function setUp() public {
        generated = new GeneratedPoolTransferVerifierStub();
        adapter = new PoolV2TransferVerifierAdapter(address(generated));
    }

    function _proof() internal pure returns (bytes memory proof) {
        uint256[2] memory a = [uint256(1), uint256(2)];
        uint256[2][2] memory b = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory c = [uint256(7), uint256(8)];
        uint256[5] memory input;
        proof = abi.encode(a, b, c, input);
    }

    function testDecodesFixedProofAndMapsFivePublicInputs() public {
        bytes32[] memory publicInputs = new bytes32[](5);
        publicInputs[0] = bytes32(uint256(11));
        publicInputs[1] = bytes32(uint256(22));
        publicInputs[2] = bytes32(uint256(33));
        publicInputs[3] = bytes32(uint256(44));
        publicInputs[4] = bytes32(uint256(55));
        uint256[5] memory expected = [uint256(11), uint256(22), uint256(33), uint256(44), uint256(55)];
        generated.setExpectedInput(expected);
        generated.setResult(true);

        assertTrue(adapter.verify(_proof(), publicInputs));
    }

    function testRejectsMalformedProofAndWrongInputLength() public {
        bytes32[] memory publicInputs = new bytes32[](5);
        assertFalse(adapter.verify(hex"", publicInputs));
        bytes32[] memory wrongInputs = new bytes32[](4);
        assertFalse(adapter.verify(_proof(), wrongInputs));
    }

    function testReturnsFalseWhenGeneratedVerifierRejectsOrReverts() public {
        bytes32[] memory publicInputs = new bytes32[](5);
        assertFalse(adapter.verify(_proof(), publicInputs));
        generated.setResult(true);
        assertTrue(adapter.verify(_proof(), publicInputs));
    }
}
