// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IPoolV2RootConsumer {
    function appendRoot(bytes32 root) external;
}

/// @notice Controlled root publisher for CurtainPoolV2.
/// @dev The pool is initialized once after deployment to avoid a circular constructor dependency.
/// Ownership and publishing are separate: ownership can remain with an admin/multisig while a
/// hot publisher service submits roots.
contract PoolV2RootManager is Ownable2Step {
    IPoolV2RootConsumer public pool;
    address public publisher;

    error ZeroAddress();
    error PoolAlreadySet();
    error PoolNotSet();
    error NotPublisher();
    error ZeroRoot();

    event PoolSet(address indexed pool);
    event PublisherSet(address indexed publisher);
    event RootPublished(bytes32 indexed root, address indexed publisher);

    constructor(address owner_, address publisher_) Ownable(owner_) {
        if (publisher_ == address(0)) revert ZeroAddress();
        publisher = publisher_;
        emit PublisherSet(publisher_);
    }

    function setPool(address pool_) external onlyOwner {
        if (pool_ == address(0)) revert ZeroAddress();
        if (address(pool) != address(0)) revert PoolAlreadySet();
        pool = IPoolV2RootConsumer(pool_);
        emit PoolSet(pool_);
    }

    function setPublisher(address publisher_) external onlyOwner {
        if (publisher_ == address(0)) revert ZeroAddress();
        publisher = publisher_;
        emit PublisherSet(publisher_);
    }

    function publishRoot(bytes32 root) external {
        if (msg.sender != publisher) revert NotPublisher();
        if (address(pool) == address(0)) revert PoolNotSet();
        if (root == bytes32(0)) revert ZeroRoot();
        pool.appendRoot(root);
        emit RootPublished(root, msg.sender);
    }
}
