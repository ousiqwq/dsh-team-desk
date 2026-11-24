import {randomUUID} from 'node:crypto';
import type {Member,Message,State,Team} from './types.ts';

/** A role can be reused. Its membership ID belongs to one uninterrupted native conversation binding. */
export interface MembershipPeriod {
  id:string;teamId:string;anchor:string;teamTitle:string;sessionId:string;label:string;createdByTeam:boolean;
  addition?:Member["addition"];lastLabel?:string;lastTeamTitle?:string;observed:number;start?:number;end?:number;
}

export function reconcileMemberships(previous:State,next:State,now=Date.now()){
  const periods=next.memberships??=[];
  const open=new Map(periods.filter(p=>p.end===undefined).map(p=>[p.sessionId,p]));
  const members=new Map<string,Member>();
  const teamOf=new Map<string,string>();
  for(const team of next.teams){
    const before=previous.teams.find(t=>t.id===team.id);
    for(const member of team.members){
      const old=before?.members.find(m=>m.sessionId===member.sessionId);
      let period=open.get(member.sessionId);
      if(period&&period.teamId!==team.id){period.end=now;period=undefined;}
      if(!period){
        const legacy=!!old&&!previous.memberships;
        period={id:randomUUID(),teamId:team.id,teamTitle:team.title,anchor:team.anchor,sessionId:member.sessionId,
          ...(member.addition&&{addition:member.addition}),label:member.label,createdByTeam:member.owned,observed:now,...(!legacy&&{start:now})};
        periods.push(period);
      }
      if(period.label!==member.label||period.lastLabel!==undefined)period.lastLabel=member.label;
      if(period.teamTitle!==team.title||period.lastTeamTitle!==undefined)period.lastTeamTitle=team.title;
      open.delete(member.sessionId);
      member.bindingId=period.id;
      if(period.start!==undefined)member.boundSince=period.start;
      if(old&&(old.label!==member.label||old.slot!==member.slot||(old.active===false)!==(member.active===false))){
        next.events.push({id:randomUUID(),kind:'member-role',time:now,teamId:team.id,sessionId:member.sessionId,
          text:(old.label!==member.label?old.label+' → '+member.label:member.label)+(old.active!==member.active?(member.active===false?' · 停用席位':' · 启用席位'):old.slot!==member.slot?' · '+(member.slot??''):'')});
      }
      members.set(member.sessionId,member);teamOf.set(member.sessionId,team.id);
    }
  }
  for(const period of open.values())period.end=now;
  for(const resource of next.resources??[])for(const lease of resource.leases){
    const grant=lease.delegation;
    if(grant&&!grant.revokedAt&&(teamOf.get(grant.member)!==grant.teamId||teamOf.get(grant.grantorMember)!==grant.teamId))grant.revokedAt=now;
  }
  // Stamp new receipts at creation. Never assign a missing legacy identity to a later tenant.
  for(const message of next.messages){
    const sender=members.get(message.sender),recipient=members.get(message.target);
    if(sender&&!message.senderBinding&&matchesTime(sender,message.time)&&teamOf.get(sender.sessionId)===message.teamId)message.senderBinding=sender.bindingId!;
    if(recipient&&!message.targetBinding&&matchesTime(recipient,message.time)&&teamOf.get(recipient.sessionId)===message.teamId)message.targetBinding=recipient.bindingId!;
  }
}

function matchesTime(member:Member,time:number){return member.boundSince===undefined||time>=member.boundSince;}
export function sameBinding(team:Team,message:Message){
  function matches(id:string,binding:string|undefined){
    const member=team.members.find(m=>m.sessionId===id);
    return !!member&&(binding?binding===member.bindingId:matchesTime(member,message.time));
  }
  return message.teamId===team.id&&matches(message.target,message.targetBinding)
    &&(message.system&&!message.senderBinding||matches(message.sender,message.senderBinding));
}

export type ProjectRecord={author:string;time:number;teamId?:string;provenance?:{teamId:string}};
export function recordTeamAt(state:State,row:ProjectRecord){
 const owner=row.provenance?.teamId??row.teamId;
 if(owner)return owner;
 const periods=(state.memberships??[]).filter(p=>p.sessionId===row.author&&row.time>=(p.start??p.observed)&&row.time<(p.end??Infinity));
 return periods.length===1?periods[0]!.teamId:undefined;
}
