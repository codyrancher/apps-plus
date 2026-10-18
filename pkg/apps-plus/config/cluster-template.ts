export const DEFAULT_CLUSTER_TEMPLATE = `apiVersion: rke-machine-config.cattle.io/v1
kind: Amazonec2Config
metadata:
  name: \${cluster}-machine
region: \${region}
zone: \${zone}
instanceType: \${instanceType}
rootSize: "\${rootSize}"
securityGroup:
  - default
  - rancher-nodes
securityGroupReadonly: true
vpcId: \${vpcId}
subnetId: \${subnetId}
---
apiVersion: provisioning.cattle.io/v1
kind: Cluster
metadata:
  name: \${cluster}
spec:
  cloudCredentialSecretName: \${cloudCredential}
  kubernetesVersion: \${kubernetesVersion}
  rkeConfig:
    machineGlobalConfig:
      cni: \${cni}
    machinePools:
      - name: pool1
        controlPlaneRole: true
        etcdRole: true
        workerRole: true
        quantity: 1
        machineConfigRef:
          kind: Amazonec2Config
          name: \${cluster}-machine
`;

export const DEFAULT_CLUSTER_VALUES = {
  kubernetesVersion: 'v1.34.4+rke2r1',
  cni:               'canal',
  region:            'us-west-2',
  zone:              'a',
  instanceType:      'c5d.xlarge',
  rootSize:          '50',
  vpcId:             'vpc-0c618e3a2ec9df47b',
  subnetId:          'subnet-0c97a9f441ca3c895',
};

export const DEFAULT_CLUSTER_DRIVER = 'amazonec2';
