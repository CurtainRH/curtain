// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import {
    PoolV2UnshieldVerifierAdapter,
    IGeneratedPoolUnshieldVerifier
} from "../../src/pool/PoolV2UnshieldVerifierAdapter.sol";

contract GeneratedPoolUnshieldVerifierStub is IGeneratedPoolUnshieldVerifier {
    bool public result;
    uint256[5] public expectedInput;

    function setResult(bool result_) external { result = result_; }
    function setExpectedInput(uint256[5] calldata input) external { expectedInput = input; }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[5] calldata input)
        external view returns (bool)
    {
        for (uint256 i; i < 5; ++i) if (input[i] != expectedInput[i]) return false;
        return result;
    }
}

contract PoolV2UnshieldVerifierAdapterTest is Test {
    GeneratedPoolUnshieldVerifierStub generated;
    PoolV2UnshieldVerifierAdapter adapter;

    function setUp() public {
        generated = new GeneratedPoolUnshieldVerifierStub();
        adapter = new PoolV2UnshieldVerifierAdapter(address(generated));
    }

    function _proof() internal pure returns (bytes memory proof) {
        uint256[2] memory a = [uint256(1), uint256(2)];
        uint256[2][2] memory b = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory c = [uint256(7), uint256(8)];
        uint256[5] memory input;
        proof = abi.encode(a, b, c, input);
    }

    function testMapsRootNullifierTokenAmountAndRecipient() public {
        bytes32[] memory inputs = new bytes32[](5);
        inputs[0] = bytes32(uint256(11));
        inputs[1] = bytes32(uint256(22));
        inputs[2] = bytes32(uint256(33));
        inputs[3] = bytes32(uint256(44));
        inputs[4] = bytes32(uint256(55));
        generated.setExpectedInput([uint256(11), uint256(22), uint256(33), uint256(44), uint256(55)]);
        generated.setResult(true);
        assertTrue(adapter.verify(_proof(), inputs));
    }

    function testRejectsMalformedProofAndWrongInputLength() public {
        bytes32[] memory inputs = new bytes32[](5);
        assertFalse(adapter.verify(hex"", inputs));
        bytes32[] memory wrongInputs = new bytes32[](4);
        assertFalse(adapter.verify(_proof(), wrongInputs));
    }
}
