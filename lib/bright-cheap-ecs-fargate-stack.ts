import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  Cluster,
  ContainerDependencyCondition,
  ContainerImage,
  FargateService,
  FargateTaskDefinition
} from "aws-cdk-lib/aws-ecs";
import { Port, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { URL } from "url";
import { HostedZone } from "aws-cdk-lib/aws-route53";
import { PublicIPSupport } from "@raykrueger/cdk-fargate-public-dns";

export class BrightCheapEcsFargateStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, 'Vpc', {
      natGateways: 0,
    });


    const task = new FargateTaskDefinition(this, 'task')

    const cluster = new Cluster(this, 'Cluster', { vpc });
    const service = new FargateService(this, 'Service', {
      cluster: cluster,
      assignPublicIp: true,
      vpcSubnets: {
        subnetType: SubnetType.PUBLIC
      },
      taskDefinition: task,
      capacityProviderStrategies: [{
        capacityProvider: 'FARGATE_SPOT',
        weight: 1
      }]
    });

    const backend = task.addContainer('backend', {
      image: ContainerImage.fromRegistry("node:20-alpine"),
      command: ['npx', 'http-server'],
      workingDirectory: '/srv',
      portMappings: [{
        containerPort: 8080
      }]
    });

    const hostedZone = HostedZone.fromLookup(this, 'tutorial.bright.dev', {
      domainName: 'tutorial.bright.dev'
    });

    const baseUrl = new URL(`https://cheap-ecs-fargate.${hostedZone.zoneName}`);

    task.addContainer('caddy', {
      image: ContainerImage.fromRegistry('caddy:2-alpine'),
      command: [
        'caddy', 'reverse-proxy', '--from', baseUrl.hostname, '--to', '127.0.0.1:8080'
      ],
      portMappings: [{
        containerPort: 80
      }, {
        containerPort: 443
      }],
    }).addContainerDependencies({
      container: backend,
      condition: ContainerDependencyCondition.START
    })

    service.connections.allowFromAnyIpv4(Port.tcp(80), "Http")
    service.connections.allowFromAnyIpv4(Port.tcp(443), "Https")

    new PublicIPSupport(this, 'PublicIPSupport', {
      cluster,
      service,
      dnsConfig: {
        domainName: baseUrl.hostname,
        hostzedZone: hostedZone.hostedZoneId,
      },
    })

  }
}
